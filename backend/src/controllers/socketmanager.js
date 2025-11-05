import { Server } from "socket.io"

let connections = {}
let messages = {}
let timeOnline = {}

export const connectToSocket = (server) => {
    
    // --- 🔴 THIS IS THE FIX 🔴 ---
    // This list MUST be your VERCEL frontend URL
    const allowedOrigins = [
      "https://nex-call-afln.vercel.app",   // Without the slash
      "https://nex-call-afln.vercel.app/",  // With the slash
    ];
    
    const io = new Server(server, {
        cors: {
            origin: allowedOrigins, // Use the list here
            methods: ["GET", "POST"],
            allowedHeaders: ["*"],
            credentials: true
        }
    });
    // --- END OF FIX ---

    io.on("connection", (socket) => {
        console.log("🟢 NEW CONNECTION:", socket.id);

        socket.on("join-call", (path) => {
            console.log(`👤 User ${socket.id} joining call: ${path}`);

            if (connections[path] === undefined) {
                connections[path] = []
            }

            // Store existing users before adding new one
            const existingUsers = [...connections[path]];
            
            // Add new user to the room
            connections[path].push(socket.id)
            timeOnline[socket.id] = new Date();

            console.log(`📋 Room "${path}" now has ${connections[path].length} user(s):`, connections[path]);

            // 1️⃣ Send the complete user list TO THE NEW USER ONLY
            socket.emit("user-joined", socket.id, connections[path]);
            console.log(`   ✉️  Sent to ${socket.id}: user-joined with all users`);

            // 2️⃣ Notify all EXISTING users about the new user
            existingUsers.forEach((existingUserId) => {
                io.to(existingUserId).emit("user-joined", socket.id, connections[path]);
                console.log(`   ✉️  Notified ${existingUserId} about new user ${socket.id}`);
            });

            // Send message history to new user
            if (messages[path] !== undefined) {
                for (let a = 0; a < messages[path].length; ++a) {
                    io.to(socket.id).emit("chat-message", 
                        messages[path][a]['data'],
                        messages[path][a]['sender'], 
                        messages[path][a]['socket-id-sender']
                    );
                }
            }
        })

        socket.on("signal", (toId, message) => {
            console.log(`📡 Signal from ${socket.id} to ${toId}`);
            io.to(toId).emit("signal", socket.id, message);
        })

        socket.on("chat-message", (data, sender) => {
            const [matchingRoom, found] = Object.entries(connections)
                .reduce(([room, isFound], [roomKey, roomValue]) => {
                    if (!isFound && roomValue.includes(socket.id)) {
                        return [roomKey, true];
                    }
                    return [room, isFound];
                }, ['', false]);

            if (found === true) {
                if (messages[matchingRoom] === undefined) {
                    messages[matchingRoom] = []
                }

                messages[matchingRoom].push({ 
                    'sender': sender, 
                    "data": data, 
                    "socket-id-sender": socket.id 
                });
                
                console.log(`💬 Chat message in room "${matchingRoom}" from ${sender}: ${data}`);

                connections[matchingRoom].forEach((elem) => {
                    io.to(elem).emit("chat-message", data, sender, socket.id);
                });
            }
        })

        socket.on("disconnect", () => {
            console.log("🔴 User disconnected:", socket.id);

            var diffTime = Math.abs(timeOnline[socket.id] - new Date());
            var key;

            for (const [k, v] of Object.entries(connections)) {
                for (let a = 0; a < v.length; ++a) {
                    if (v[a] === socket.id) {
                        key = k;

                        console.log(`   📤 User ${socket.id} leaving room "${key}"`);

                        // Notify all other users in the room
                        for (let a = 0; a < connections[key].length; ++a) {
                            if (connections[key][a] !== socket.id) {
                                io.to(connections[key][a]).emit('user-left', socket.id);
                                console.log(`   ✉️  Notified ${connections[key][a]} that ${socket.id} left`);
                            }
                        }

                        // Remove user from connections
                        var index = connections[key].indexOf(socket.id);
                        connections[key].splice(index, 1);

                        console.log(`   📋 Room "${key}" now has ${connections[key].length} user(s):`, connections[key]);

                        // Clean up empty room
                        if (connections[key].length === 0) {
                            delete connections[key];
                            delete messages[key];
                            console.log(`   🗑️  Room "${key}" deleted (empty)`);
                        }
                    }
                }
            }

            // Clean up user data
            delete timeOnline[socket.id];
        })
    })

    return io;
}