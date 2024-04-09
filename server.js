const WebSocket = require("ws");
const { Chess } = require("chess.js");

const wss = new WebSocket.Server({ port: 3000 });

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
      case "new_game":
        let [pubKey, gameCode] = rest;
        // Initialize game state
        if (!games[gameCode]) {
          const chess = new Chess();
          games[gameCode] = {
            chess,
            players: [ws], // Store WebSocket connection of the player
            pubKeys: [pubKey], // Store public key for identification
            observers: [], // Keeps track of observers
            whitePubKey: null, // Store the public key of the white player
            blackPubKey: null, // Store the public key of the black player
          };
          console.log(`Game ${gameCode} created`);
        } else {
          ws.send(createMessage("error", [`Game ${gameCode} already exists.`]));
        }
        break;

      case "join_game":
        console.log(`Joining Game`);
        const [pubKey1, gameCode0] = rest;
        // Player joining existing game
        const game = games[gameCode0];
        if (game) {
          if (game.players.length < 2) {
            game.players.push(ws);
            game.pubKeys.push(pubKey1);
            console.log(`Player joined game ${gameCode0}`);

            // Check if the game now has two players to start the game
            if (game.players.length === 2) {
              console.log(`Game ${gameCode0} is starting`);
              startGame(gameCode0);
            }
          } else {
            ws.send(createMessage("error", ["Game is full."]));
          }
        } else {
          ws.send(createMessage("error", ["Game does not exist."]));
        }
        break;

      case "move":
        const [gameCode1, f, t] = rest;
        const currentGame = games[gameCode1];
        let fl = f.toLowerCase();
        let tl = t.toLowerCase();
        // Handle player moves
        if (currentGame && currentGame.chess.move({ from: fl, to: tl })) {
          console.log(`Move from ${f} to ${t} in game ${gameCode1}`);
          // Notify the opponent of the move
          games[gameCode1].players.forEach((player) => {
            if (player !== ws) {
              // Don't send the move to the player who made it
              player.send(createMessage("opponent_move", [f, t]));
            }
          });
          let fen = currentGame.chess.fen();
          currentGame.observers.forEach((observer) => {
            observer.send(createMessage("stream", [gameCode1, fen]));
          });
        } else {
          ws.send(createMessage("error", ["Invalid move or game code."]));
        }
        break;

      case "get_active_games":
        if (activeGameIds.length > 0) {
          activeGameIds.forEach((gameId) => {
            const gameInfo = games[gameId];
            if (gameInfo) {
              ws.send(
                createMessage("active", [
                  gameId,
                  gameInfo.pubKeys[0],
                  gameInfo.pubKeys[1],
                ])
              );
            }
          });
        } else {
          ws.send(
            createMessage("no_active_games", ["No active games at the moment."])
          );
        }
        break;

      case "game_over":
        const [gameCodeOver] = rest;
        // Find the index of the game code in the active games array
        const index = activeGameIds.indexOf(gameCodeOver);
        if (index !== -1) {
          // If the game code is found, remove it from the active games array
          activeGameIds.splice(index, 1);
          console.log(
            `Game ${gameCodeOver} is over and removed from active games.`
          );
        } else {
          // If the game code is not found, possibly log or handle the error
          console.log(`Game ${gameCodeOver} not found in active games.`);
        }
        break;

      case "get_game":
        const [gameCode2] = rest;
        const ongoingGame = games[gameCode2];
        if (ongoingGame) {
          const fen = ongoingGame.chess.fen();
          ws.send(
            createMessage("init_game", [
              gameCode2,
              fen,
              ongoingGame.whitePubKey,
              ongoingGame.blackPubKey,
            ])
          );
          ongoingGame.observers.push(ws); // Add ws to observers
        } else {
          ws.send(createMessage("error", ["Game does not exist."]));
        }
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

function startGame(gameCode) {
  const game = games[gameCode];
  console.log(`Game ${gameCode} is starting`);

  // Randomly decide which player is white or black
  const isFirstPlayerWhite = Math.random() < 0.5;

  // Notify both players that the game has started and assign colors
  game.players.forEach((player, index) => {
    const color = (isFirstPlayerWhite ? index === 0 : index !== 0) ? 0 : 1;

    if (isFirstPlayerWhite) {
      game.whitePubKey = game.pubKeys[0];
      game.blackPubKey = game.pubKeys[1];
    } else {
      game.whitePubKey = game.pubKeys[1];
      game.blackPubKey = game.pubKeys[0];
    }

    player.send(createMessage("color", [color]));
  });

  // Send a message to both players indicating the game has started
  game.players.forEach((player) => {
    player.send(createMessage("game_started", []));
  });

  activeGameIds.push(gameCode);
}

console.log("WebSocket server started on ws://127.0.0.1:3000");
