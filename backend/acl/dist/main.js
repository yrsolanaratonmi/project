import express from "express";
import redis from "redis";
const redisClient = await redis.createClient({
    url: "redis://default:redispw@redis:6379"
}).connect();
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
app.get("/code", async (req, res) => {
    const userData = parseRequestUserData(req);
    const redisKey = `login-code-${userData.id}`;
    const newKey = Math.floor(Math.random() * 1000) + 1000 + "";
    await redisClient.set(redisKey, newKey, { EX: 60 });
    res.send(userData.encode(newKey));
    return;
});
app.listen(3000, () => console.log('started'));
