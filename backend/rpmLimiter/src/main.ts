import express from "express"
import redis from "redis"

const redisClient = await redis.createClient({
    url: "redis://default:redispw@redis:6379"
}).connect();


const app = express();

app.get("/", async (req, res) => {
    const id = req.headers["x-user-id"] as string
    const prefix = req.headers["x-forwarded-uri"] as string
    const method = req.headers["x-forwarded-method"] as string
    const key = `${id}-${method}-${prefix}`
    await redisClient.set(key, 0, { NX: true, EX: 60 })
    await redisClient.incr(key)
    const rpm = await redisClient.get(key);
    console.log(`User ${id} method: ${method} uri: ${prefix} rpm ${rpm}`)
    if (!!rpm && +rpm > 4) {
        res.status(429).send()
        return
    }
    res.send()
});

app.listen(3000, () => console.log("started"))