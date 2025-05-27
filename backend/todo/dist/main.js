import express from "express";
import pg from "pg";
import { v4 } from "uuid";
const db = new pg.Client({
    "host": "db",
    "password": "very-strong-password",
    "user": "postgres",
    "database": "postgres"
});
await db.connect();
await db.query(`
    CREATE TABLE IF NOT EXISTS todos(
    id UUID not null,
    author UUID not null,
    title TEXT not null,
    description TEXT not null,
    createdAt BIGINT not null,
    primary key (id)
)`);
const app = express();
const parseRequestUserData = (req) => ({
    hasRole: (role) => req.headers['x-user-roles'].split(", ").some(x => x === role),
    id: req.headers["x-user-id"],
    encode: (content) => {
        const keyContent = req.headers['x-key-content'];
        return content.split("").map((x, i) => (x + keyContent[i % keyContent.length])).join("");
    },
    decode: (content) => {
        return content.split("").map((x, i) => i % 2 ? "" : x).join("");
    },
});
app.post("/", express.json(), async (req, res) => {
    const userData = parseRequestUserData(req);
    const todo = {
        id: v4(),
        author: userData.id,
        title: req.body.title,
        description: req.body.description,
        createdAt: Date.now(),
    };
    await db.query(`
        INSERT INTO todos (
            id,
            author,
            title,
            description,
            createdAt
        ) VALUES (
            ${pg.escapeLiteral(todo.id)},
            ${pg.escapeLiteral(todo.author)},
            ${pg.escapeLiteral(userData.decode(todo.title))},
            ${pg.escapeLiteral(userData.decode(todo.description))},
            ${todo.createdAt}
        )
    `);
    res.send(todo);
});
app.patch("/:id", express.json(), async (req, res) => {
    const userData = parseRequestUserData(req);
    const todo = {
        id: req.params.id,
        author: userData.id,
        title: userData.decode(req.body.title),
        description: userData.decode(req.body.description),
    };
    await db.query(`
        UPDATE todos SET
        title = ${pg.escapeLiteral(todo.title)},
        description = ${pg.escapeLiteral(todo.description)}
        WHERE id = ${pg.escapeLiteral(todo.id)}
        AND author = ${pg.escapeLiteral(todo.author)}
    `);
    res.send();
});
app.delete("/:id", async (req, res) => {
    const userData = parseRequestUserData(req);
    const id = req.params.id;
    let query = `DELETE FROM todos WHERE id = ${pg.escapeLiteral(id)}`;
    if (!userData.hasRole('admin')) {
        query += ` AND author = ${pg.escapeLiteral(userData.id)}`;
    }
    const result = await db.query(query);
    if (result.rowCount == 0) {
        res.status(404).send();
        return;
    }
    res.send();
});
app.get("/", async (req, res) => {
    console.log("test");
    const userData = parseRequestUserData(req);
    let author = userData.id;
    if (!!req.query['author'] && userData.hasRole("admin")) {
        author = req.query['author'];
    }
    const list = await db.query(`
        SELECT
            id,
            title,
            description,
            createdAt 
        FROM todos
        WHERE author = ${pg.escapeLiteral(author)}
    `);
    console.log(list.rows);
    res.send(list.rows.map(todo => ({
        id: todo.id,
        title: userData.encode(todo.title),
        description: userData.encode(todo.description),
        createdAt: +todo.createdat,
    })));
});
app.listen(3000, () => console.log("started"));
