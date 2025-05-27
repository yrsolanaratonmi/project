import express from "express"
import pg from "pg"
import {v4} from "uuid"
import CryptoJS from 'crypto-js';



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

type UserData = {
    hasRole: (role: string) => boolean;
    id: string;
    encode: (content: string) => string;
    decode: (content: string) => string;
}

const parseRequestUserData = (req: express.Request): UserData => ({
    hasRole: (role: string) => (req.headers['x-user-roles'] as string).split(", ").some(x => x === role),
    id: req.headers["x-user-id"] as string,
    encode: (content: string) => {
        const keyContent = req.headers['x-key-content'] as string;
        const encoded =  CryptoJS.AES.encrypt(content, keyContent).toString();
        return encoded
    },
    decode: (content: string) => {
        const keyContent = req.headers['x-key-content'] as string;

        const decoded = CryptoJS.AES.decrypt(content, keyContent).toString(
            CryptoJS.enc.Utf8
        );
        return decoded
    },
})

app.post("/", express.json(), async (req, res) => {
    console.log('new note / data from client', req.body)
    const userData = parseRequestUserData(req)
    const todo = {
        id: v4(),
        author: userData.id,
        title: req.body.title,
        description: req.body.description,
        createdAt: Date.now(),
    }


    const userInDb = await db.query(`SELECT id, roles, password_hash, banTime FROM users WHERE id = '${userData.id}'`)
     console.log(userInDb.rows[0], '-time')

        if (+userInDb.rows[0].bantime > Date.now()) {
            res.status(405).send({unbanTime: new Date(+userInDb.rows[0].bantime).toLocaleString()})
            return
        }
    console.log('new note / data set to database', 'todoId', todo.id, 'todoAuthor', todo.author, 'todoTitle', todo.title, 'todoDescription', todo.description)

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
    console.log('new todo / data sent to client', todo)
    res.send(todo)
});

app.patch("/:id", express.json(), async (req, res) => {
    console.log('edit note / data from client', req.body)
    const userData = parseRequestUserData(req)
    const todo = {
        id: req.params.id,
        author: userData.id,
        title: userData.decode(req.body.title),
        description: userData.decode(req.body.description),
    }

     const userInDb = await db.query(`SELECT id, roles, password_hash, banTime FROM users WHERE id = '${userData.id}'`)
     console.log(userInDb.rows[0], '-time')

        if (+userInDb.rows[0].bantime > Date.now()) {
            res.status(405).send({unbanTime: new Date(+userInDb.rows[0].bantime).toLocaleString()})
            return
        }


     console.log('edit note / data set to database', 'todoTitle', userData.decode(req.body.title), 'todoDescription', userData.decode(req.body.description), 'todoId', todo.id, 'todoAuthor', todo.author)
    await db.query(`
        UPDATE todos SET
        title = ${pg.escapeLiteral(todo.title)},
        description = ${pg.escapeLiteral(todo.description)}
        WHERE id = ${pg.escapeLiteral(todo.id)}
        AND author = ${pg.escapeLiteral(todo.author)}
    `);

    console.log('edit note / nothing sent to client')
    res.send()
});

app.delete("/:id", async (req, res) => {
       console.log('delete note / data from client', req.body)
    const userData = parseRequestUserData(req)

     const userInDb = await db.query(`SELECT id, roles, password_hash, banTime FROM users WHERE id = '${userData.id}'`)
     console.log(userInDb.rows[0], '-time')

        if (+userInDb.rows[0].bantime > Date.now()) {
            res.status(405).send({unbanTime: new Date(+userInDb.rows[0].bantime).toLocaleString()})
            return
        }

    const id = req.params.id;

    let query = `DELETE FROM todos WHERE id = ${pg.escapeLiteral(id)}`

    if (!userData.hasRole('admin')) {
        query += ` AND author = ${pg.escapeLiteral(userData.id)}`
    }

    const result = await db.query(query)
    if (result.rowCount == 0) {
        res.status(404).send()
        return;
    }
    console.log('delete note / nothing sent to client')

    res.send();
});

app.get("/", async (req, res) => {
          console.log('get all notes / data from client', req.body)
    const userData = parseRequestUserData(req)

    let author = userData.id;

    if (!!req.query['author'] && userData.hasRole("admin")) {
        author = req.query['author'] as string
    }


     const userInDb = await db.query(`SELECT id, roles, password_hash, banTime FROM users WHERE id = '${userData.id}'`)
     console.log(userInDb.rows[0], '-time')

        if (+userInDb.rows[0].bantime > Date.now()) {
            res.status(405).send({unbanTime: new Date(+userInDb.rows[0].bantime).toLocaleString()})
            return
        }
    console.log('get all notes / data for filter in database', 'author', author)

    const list = await db.query(`
        SELECT
            id,
            title,
            description,
            createdAt
        FROM todos
        WHERE author = ${pg.escapeLiteral(author)}
    `);
    res.send(list.rows.map(todo => ({
        id: todo.id,
        title: userData.encode(todo.title),
        description: userData.encode(todo.description),
        createdAt: +todo.createdat,
    })));
    console.log('get all notes / data sent to client', list.rows.map(todo => ({
        id: todo.id,
        title: userData.encode(todo.title),
        description: userData.encode(todo.description),
        createdAt: +todo.createdat,
    })))
});

app.listen(3000, () => console.log("started"));