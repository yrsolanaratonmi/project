
import express from "express";
import jwt from "jsonwebtoken";
import fs from "fs";
import pg from "pg";
import argon2 from "argon2";
import { v4 } from "uuid";
import redis from "redis";


import bodyParser from 'body-parser'


const db = new pg.Client({
    "host": "db",
    "password": "very-strong-password",
    "user": "postgres",
    "database": "postgres"
});
(async () => {
    await db.connect();
    await db.query("CREATE TABLE IF NOT EXISTS users (id UUID not null, login varchar(255) not null unique, banTime BIGINT not null, password_hash varchar(255) not null, roles varchar(255), primary key (id))");
    await db.query("CREATE TABLE IF NOT EXISTS keys (id UUID not null, author UUID not null, key TEXT not null, primary key (id))");
})();

const redisClient = await redis.createClient({
    url: "redis://default:redispw@redis:6379"
}).connect();

const privateKey = fs.readFileSync("keys/private.key");

const app = express();

// parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }))

// parse application/json
app.use(bodyParser.json())


type TokensPair = {
    accessToken: string;
    refreshToken: string;
}

type TokenPayload = {
    id: string;
    roles: string[];
    key: string;
    type: 'access' | 'refresh',
    issuer: string;
};

type GenerateTokenPayload = Omit<TokenPayload, "issuer" | "type">;

const verifyWithDefaultOptions = async (token: string): Promise<boolean> => {
    return new Promise((res) => {
        try {
            jwt.verify(token, privateKey)
            res(true)
        } catch {
            res(false)
        }
    });
}
const generateTokensForUser = async (payload: GenerateTokenPayload): Promise<TokensPair> => {
    return {
        accessToken: jwt.sign({ ...payload, type: 'access', issuer: "roman.com"}, privateKey, { expiresIn: "10m" }),
        refreshToken: jwt.sign({ ...payload, type: "refresh", issuer: "roman.com"}, privateKey, { expiresIn: "2d" }),
    }
}

export type UserData = {
    hasRole: (role: string) => boolean;
    id: string;
    encode: (content: string) => string;
    decode: (content: string) => string;
}

const parseRequestUserData1 = (req: express.Request): Pick<UserData, 'hasRole' | 'id'> => ({
    hasRole: (role: string) => (req.headers['X-User-Roles'] as [string]).some(x => x === role),
    id: req.headers["X-User-Id"] as string,

})

app.post("/register", express.json(), async (req, res) => {
    console.log('register / request data from client', req.body)
    const user = {
        id: v4(),
        login: req.body.login,
        passwordHash: await argon2.hash(req.body.password, { hashLength: 50 }),
    };

    const key = {
        id: v4(),
        content: req.body.key,
    };

        console.log('register / data to database',
            'into users - ', user.id, user.login, user.passwordHash,
            'into keys - ', key.id, user.id, key.content
        )


    try {
        await db.query(`INSERT INTO users (id, login, banTime, password_hash, roles) values ('${user.id}', '${user.login}', 0, '${user.passwordHash}', 'admin')`)
        await db.query(`insert INTO keys (id, author, key) values (${pg.escapeLiteral(key.id)}, ${pg.escapeLiteral(user.id)}, ${pg.escapeLiteral(key.content)})`)

        const { accessToken, refreshToken } = await generateTokensForUser({ id: user.id, roles: ["admin"], key: key.id});
        res.send({
            accessToken,
            refreshToken,
            keyId: key.id,
        });

        console.log('register / data sent to client', 'accessToken', accessToken, 'refreshToken', refreshToken, 'keyId', key.id)

    } catch {
        res.status(400).send()
        return
    }
});

app.post("/login", express.json(), async (req, res) => {
    type LoginBody = {
        login: string;
        password: string;
        code: string;
        keyId?: string;
        keyContent?: string;
    };

    console.log('login / request data from client', req.body)

    try {
        const body = req.body as LoginBody;

        // check user exists
        const userInDb = await db.query(`SELECT id, roles, password_hash, banTime FROM users WHERE login = '${body.login}'`)
        if (userInDb.rowCount != 1) {
            res.status(404).send()
            return
        }

        console.log(userInDb.rows[0], '-time')

        if (+userInDb.rows[0].bantime > Date.now()) {
            res.status(405).send({unbanTime: new Date(+userInDb.rows[0].bantime).toLocaleString()})
            return
        }

        if (!await argon2.verify(userInDb.rows[0].password_hash, body.password)) {
            res.status(401).send()
            return
        }

        // return reuqest key
        if (!!body.keyId) {
            const data = await generateTokensForUser({ id: userInDb.rows[0].id, roles: userInDb.rows[0].roles.split(","), key: body.keyId })
            console.log('login / request data sent to client if device is authorized', data)
            res.send(data)
            return;
        }

        // check one time code
        const redisKey = `login-code-${userInDb.rows[0].id}`;
        const storedCode = await redisClient.get(redisKey);
        await redisClient.del(redisKey)

        if (storedCode !== body.code) {
            res.status(401).send();
            return;
        }

        // genrate new key
        const key = {
            id: v4(),
            content: body.keyContent as string,
        };

                    console.log('login / request data set to database if device isnt authorized', 'keyId', key.id, 'user', userInDb.rows[0].id, 'keyContent', key.content)

        await db.query(`insert INTO keys (id, author, key) values (${pg.escapeLiteral(key.id)}, ${pg.escapeLiteral(userInDb.rows[0].id)}, ${pg.escapeLiteral(key.content)})`);
        const { accessToken, refreshToken } = await generateTokensForUser({ id: userInDb.rows[0].id, roles: userInDb.rows[0].roles.split(","), key: key.id });
        res.send({
            accessToken,
            refreshToken,
            keyId: key.id,
        });
                console.log('login / data sent to client', 'accessToken', accessToken, 'refreshToken', refreshToken, 'keyId', key.id)

        return;
    } catch {
        res.status(500).send()
    }
});

app.post("/refresh", express.json(), async (req, res) => {
        console.log('refresh / request data from client', req.body)

    const isValid = await verifyWithDefaultOptions(req.body.refreshToken)
    if (!isValid) {
        res.status(401).send()
        return
    }

    const payload = jwt.decode(req.body.refreshToken) as TokenPayload
    if (payload.type !== "refresh") {
        res.status(400).send();
        return;
    }

    const userInDb = await db.query(`SELECT id, roles FROM users WHERE id = '${payload.id}'`)

    if (userInDb.rowCount != 1) {
        res.status(401).send()
        return
    }

    const data = await generateTokensForUser({ id: payload.id, roles: userInDb.rows[0].roles.split(','), key: payload.key })

    res.send(data );
    console.log('refresh / sent data to client', data)
});

app.post('/admin', async (req:  express.Request, res) => {


        const token = req.headers.authorization?.replace("Bearer ", "")
  const payload: any = jwt.decode(token as string);
  req.headers['X-User-Id'] = (payload as any).id
  req.headers['X-User-Roles'] = (payload as any).roles
   console.log('function', req.headers)
     const isValid = await verifyWithDefaultOptions(req.headers.accessToken as string);
         const userData = parseRequestUserData1(req);

    const isAdmin = userData.hasRole('admin')

    console.log('isAdmin',isAdmin, 'isValid', isValid)
    if (!isAdmin) {
        res.status(401).send()
        return
    }


    const allUsers = await db.query(`SELECT login, banTime FROM users WHERE id != '${payload.id}'`)


    console.log('allUsers', allUsers.rows)
res.send(allUsers.rows)


})

app.post('/ban', async (req, res) => {


        const token = req.headers.authorization?.replace("Bearer ", "")
  const payload: any = jwt.decode(token as string);
  req.headers['X-User-Id'] = (payload as any).id
  req.headers['X-User-Roles'] = (payload as any).roles
   console.log('function', req.headers)
     const isValid = await verifyWithDefaultOptions(req.headers.accessToken as string);
         const userData = parseRequestUserData1(req);

    const isAdmin = userData.hasRole('admin')

    console.log('isAdmin',isAdmin, 'isValid', isValid)
    if (!isAdmin) {
        res.status(401).send()
        return
    }
    const time = req.body.time;

    console.log('time', time , typeof time)

    if (req.body.unban) {
        await db.query(`UPDATE users SET banTime = ${0} WHERE login = '${req.body.login}'`)
    } else {
         await db.query(`UPDATE users SET banTime = ${time} WHERE login = '${req.body.login}'`)
    }


    res.send()
})

app.get("/parse", async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "")
    if (!token) {
        res.status(401).send();
        return;
    }

    const isValid = await verifyWithDefaultOptions(token)
    if (!isValid) {
        res.status(401).send()
        return
    }

    const payload = jwt.decode(token) as TokenPayload


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