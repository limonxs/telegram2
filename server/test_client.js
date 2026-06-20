const { io } = require("socket.io-client");

const socket = io("http://localhost:3001");

socket.on("connect", () => {
  console.log("Connected to server with ID:", socket.id);
  socket.emit("login", { username: "LIMONLIGHT", avatar: "" }, (res) => {
    console.log("Login response:", JSON.stringify(res, null, 2));
    
    // Try to create a group
    socket.emit("create_group", { name: "test_group_from_script" }, (groupRes) => {
      console.log("Create group response:", groupRes);
      process.exit(0);
    });
  });
});

socket.on("connect_error", (err) => {
  console.error("Connection error:", err.message);
  process.exit(1);
});
