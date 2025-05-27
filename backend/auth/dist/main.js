import express from "express";
import jwt from "jsonwebtoken";
import fs from "fs";
import pg from "pg";
import argon2 from "argon2";
import { v4 } from "uuid";
import redis from "redis";
const db = new pg.Client({
    "host": "db",
    "password": "very-strong-password",
    "user": "postgres",
    "database": "postgres"
});
(async () => {
    await db.connect();
    await db.query("CREATE TABLE IF NOT EXISTS users (id UUID not null, login varchar(255) not null unique, password_hash varchar(255) not null, roles varchar(255), primary key (id))");
    await db.query("CREATE TABLE IF NOT EXISTS keys (id UUID not null, author UUID not null, key TEXT not null, primary key (id))");
})();
const redisClient = await redis.createClient({
    url: "redis://default:redispw@redis:6379"
}).connect();
const privateKey = fs.readFileSync("keys/private.key");
const app = express();
const verifyWithDefaultOptions = async (token) => {
    return new Promise((res) => {
        try {
            jwt.verify(token, privateKey);
            res(true);
        }
        catch {
            res(false);
        }
    });
};
const generateTokensForUser = async (payload) => {
    return {
        accessToken: jwt.sign({ ...payload, type: 'access', issuer: "roman.com" }, privateKey, { expiresIn: "10m" }),
        refreshToken: jwt.sign({ ...payload, type: "refresh", issuer: "roman.com" }, privateKey, { expiresIn: "2d" }),
    };
};
app.post("/register", express.json(), async (req, res) => {
    const user = {
        id: v4(),
        login: req.body.login,
        passwordHash: await argon2.hash(req.body.password, { hashLength: 50 }),
    };
    const key = {
        id: v4(),
        content: req.body.key,
    };
    try {
        await db.query(`INSERT INTO users (id, login, password_hash, roles) values ('${user.id}', '${user.login}', '${user.passwordHash}', 'user')`);
        await db.query(`insert INTO keys (id, author, key) values (${pg.escapeLiteral(key.id)}, ${pg.escapeLiteral(user.id)}, ${pg.escapeLiteral(key.content)})`);
        const { accessToken, refreshToken } = await generateTokensForUser({ id: user.id, roles: ["user"], key: key.id });
        res.send({
            accessToken,
            refreshToken,
            keyId: key.id,
        });
    }
    catch {
        res.status(400).send();
        return;
    }
});
app.post("/login", express.json(), async (req, res) => {
    try {
        const body = req.body;
        // check user exists
        const userInDb = await db.query(`SELECT id, roles, password_hash FROM users WHERE login = '${body.login}'`);
        if (userInDb.rowCount != 1) {
            res.status(404).send();
            return;
        }
        if (!await argon2.verify(userInDb.rows[0].password_hash, body.password)) {
            res.status(401).send();
            return;
        }
        // return reuqest key
        if (!!body.keyId) {
            res.send(await generateTokensForUser({ id: userInDb.rows[0].id, roles: userInDb.rows[0].roles.split(","), key: body.keyId }));
            return;
        }
        // check one time code
        const redisKey = `login-code-${userInDb.rows[0].id}`;
        const storedCode = await redisClient.get(redisKey);
        await redisClient.del(redisKey);
        if (storedCode !== body.code) {
            res.status(401).send();
            return;
        }
        // genrate new key
        const key = {
            id: v4(),
            content: body.keyContent,
        };
        await db.query(`insert INTO keys (id, author, key) values (${pg.escapeLiteral(key.id)}, ${pg.escapeLiteral(userInDb.rows[0].id)}, ${pg.escapeLiteral(key.content)})`);
        const { accessToken, refreshToken } = await generateTokensForUser({ id: userInDb.rows[0].id, roles: userInDb.rows[0].roles.split(","), key: key.id });
        res.send({
            accessToken,
            refreshToken,
            keyId: key.id,
        });
        return;
    }
    catch {
        res.status(500).send();
    }
});
app.post("/refresh", express.json(), async (req, res) => {
    const isValid = await verifyWithDefaultOptions(req.body.refreshToken);
    if (!isValid) {
        res.status(401).send();
        return;
    }
    const payload = jwt.decode(req.body.refreshToken);
    if (payload.type !== "refresh") {
        res.status(400).send();
        return;
    }
    const userInDb = await db.query(`SELECT id, roles FROM users WHERE id = '${payload.id}'`);
    if (userInDb.rowCount != 1) {
        res.status(401).send();
        return;
    }
    res.send(await generateTokensForUser({ id: payload.id, roles: userInDb.rows[0].roles.split(','), key: payload.key }));
});
app.get("/parse", async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) {
        res.status(401).send();
        return;
    }
    const isValid = await verifyWithDefaultOptions(token);
    if (!isValid) {
        res.status(401).send();
        return;
    }
    const payload = jwt.decode(token);
    const key = await db.query(`SELECT key FROM keys WHERE author = ${pg.escapeLiteral(payload.id)} AND id = ${pg.escapeLiteral(payload.key)}`);
    if (key.rowCount !== 1) {
        res.status(401).send();
        return;
    }
    res.setHeader('X-User-Id', payload.id);
    res.setHeader('X-User-Roles', payload.roles);
    res.setHeader('X-key-content', key.rows[0].key);
    res.send();
});
app.listen(3000, () => console.log('started'));
