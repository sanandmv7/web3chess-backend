const WebSocket = require("ws");

const PORT = 3000;
const wss = new WebSocket.Server({ port: PORT });

// Helper function to create message strings
const createMessage = (cmd, args) => {
  return `${cmd}::${args.join("::")}`;
};

const games = {}; // Store game states
let activeGameIds = [];

wss.on("connection", function connection(ws) {
  console.log("A new client connected!");

  ws.on("message", function incoming(event) {
    const message = event.toString();
    console.log("Received: %s", message);
    // Client sends messages formatted as "cmd::arg1::arg2..."
    const [cmd, ...rest] = message.split("::");
    console.log(`cmd: ${cmd}`);

    switch (cmd) {
      case "init_chat":
        const [gc, pk] = rest;
        if (!games[gc]) {
          games[gc] = {
            players: [ws],
            pubKeys: [pk],
          };
        } else {
          const game = games[gc];
          if (game.players.length < 2) {
            game.players.push(ws);
            game.pubKeys.push(pk);
          }
        }
        break;
      case "chat":
        const [gameCode, pubKey, chatMessage, isBlack, isWhite, amount, ts] =
          rest;
        // if (!games[gameCode]) {
        //     games[gameCode] = {
        //         players: [ws],
        //         pubKeys: [pubKey],
        //         messageCached: createMessage("chat", [gameCode, pubKey, chatMessage, isBlack, isWhite, amount]),
        //     }
        // } else {
        //     const game = games[gameCode];
        //     if (game.players.length < 2) {
        //         game.players.push(ws);
        //         game.pubKeys.push(pubKey);
        //         ws.send(game.messageCached);
        //     }
        // }
        // Logic to handle chat message
        const chatPayload = createMessage("chat", [
          gameCode,
          pubKey,
          chatMessage,
          isBlack,
          isWhite,
          amount,
          ts,
        ]);
        broadcastToGame(gameCode, chatPayload);
        break;
      default:
        console.log("Unknown cmd");
        break;
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected");
    // Handle player disconnection, clean up game state etc.
  });
});

// Broadcasts a message to all players in a game
function broadcastToGame(gameCode, message) {
  const game = games[gameCode];
  if (game) {
    // const payload = JSON.stringify(message);
    // Sending message to all players and observers in the game
    game.players.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
    // (game.observers || []).forEach(observer => {
    //   if (observer.readyState === WebSocket.OPEN) {
    //     observer.send(payload);
    //   }
    // });
  }
}

console.log(`WebSocket server started on ws://127.0.0.1:${PORT}`);
