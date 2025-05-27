import express from "express"
import redis from "redis"
import CryptoJS from 'crypto-js';


const redisClient = await redis.createClient({
    url: "redis://default:redispw@redis:6379"
}).connect();

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

app.get("/code", async (req, res) => {
    const userData = parseRequestUserData(req);



    const redisKey = `login-code-${userData.id}`;

    const newKey = Math.floor(Math.random() * 1000) + 1000 + "";

    await redisClient.set(redisKey, newKey, { EX: 60 });

    res.send(userData.encode(newKey));
    console.log('acl / code sent to client', userData.encode(newKey))
    return;
});

app.listen(3000, () => console.log('started'));