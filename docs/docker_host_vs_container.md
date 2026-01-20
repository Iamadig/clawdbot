# Docker Host vs. Container: Where do my files live?

## The Concepts

1.  **The Host (Your VPS)**
    *   **User**: `root`
    *   **Path**: `/root/clawd`
    *   **Status**: **PERSISTENT**. 
    *   This is the "Real World". Files here are safe on your hard drive. If you restart the server or delete Docker, these files stay.

2.  **The Container (The Virtual Machine)**
    *   **User**: `node` (inside the box)
    *   **Path**: `/home/node/clawd`
    *   **Status**: **EPHEMERAL** (mostly).
    *   This is a temporary "box" where the program runs. Normally, when you destroy a box, everything inside vanishes.

## The Magic Link: "Volume Mounting"

We have created a "magic window" between the two.

In your `docker-compose.yml`, we have this line:
```yaml
volumes:
  - /root/clawd:/home/node/clawd
```

This means: **"Take the actual folder `/root/clawd` from the VPS, and stick it into the container at `/home/node/clawd`."**

*   When the bot writes to `/home/node/clawd/AGENTS.md` inside the container...
*   ...it is INSTANTLY writing to `/root/clawd/AGENTS.md` on your VPS.
*   They are the **exact same file**.

## Summary Table

| Feature | VPS (Host) | Container | Relationship |
| :--- | :--- | :--- | :--- |
| **Path** | `/root/clawd/AGENTS.md` | `/home/node/clawd/AGENTS.md` | **SAME FILE** (Mirrored) |
| **User** | `root` | `node` | Different users, same data |
| **Persistence** | ✅ Safe forever | ✅ Safe (because it's mounted) | The mount saves it. |
| **Code** | `/root/clawdbot` | `/app` (or similar) | **COPIED** (Not mirrored) |

**Important Distinction:**
*   **Your Data (`clawd`)** is **mirrored**. (Live updates).
*   **Your Code (`clawdbot`)** is usually **copied** during build. If you edit code on the VPS, you often need to `rebuild` the container to see changes.
