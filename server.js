const WebSocket = require("ws");
const { Chess } = require("chess.js");
require("dotenv").config();
const { ethers } = require("ethers");

const PORT = 3000;
const RPC_URL = process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const ABI = [
  {
    inputs: [
      { internalType: "uint256", name: "game", type: "uint256" },
      { internalType: "address", name: "winner", type: "address" },
    ],
    name: "declareWinner",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "gameId", type: "uint256" }],
    name: "returnWagers",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];
const provider = ethers.getDefaultProvider(RPC_URL);
const signer = new ethers.Wallet(PRIVATE_KEY, provider);
let contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);

const wss = new WebSocket.Server({ port: PORT });

// Helper function to create message strings
const createMessage = (cmd, args) => {
  return `${cmd}::${args.join("::")}`;
};

const games = {}; // Store game states
let activeGameIds = [];

console.log(`RPC_URL: ${RPC_URL}`);

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

          // Check if the game is over
          if (currentGame.chess.isGameOver()) {
            console.log(`Game ${gameCode1} is over.`);
            let winnerPubKey = null;
            if (currentGame.chess.isCheckmate()) {
              console.log(`checkmate`);
              // Determine the winner based on who is not in check
              const winnerIsWhite = currentGame.chess.turn() === "w" ? 0 : 1; // 'w' means white just moved and put black in checkmate, so black (1) loses
              if (winnerIsWhite) {
                console.log(`winnerIsWhite`);
                winnerPubKey = currentGame.whitePubKey;
              } else {
                console.log(`winnerIsBlack`);
                winnerPubKey = currentGame.blackPubKey;
              }

              console.log(`winner: ${winnerPubKey}`);
              // Call the blockchain function if there's a winner
              if (winnerPubKey) {
                console.log(`calling declareWinnerOnBlockchain`);
                declareWinnerOnBlockchain(gameCode1, winnerPubKey);
              }
            } else if (
              currentGame.chess.isDraw() ||
              currentGame.chess.isStalemate() ||
              currentGame.chess.isThreefoldRepetition()
            ) {
              console.log(`draw`);
              returnWagersOnBlockchain(gameCode1);
            }
          }
        } else {
          ws.send(createMessage("error", ["Invalid move or game code."]));
        }
        break;

      case "get_active_games":
        const activeGameId = activeGameIds[activeGameIds.length - 1];
        if (activeGameId) {
          const gameInfo = games[activeGameId];
          ws.send(
            createMessage("active", [
              activeGameId,
              gameInfo.pubKeys[0],
              gameInfo.pubKeys[1],
            ])
          );
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
      case "chat":
        const [gameCode3, pubKey2, chatMessage, isBlack, isWhite, amount] =
          rest;
        // Logic to handle chat message
        const chatPayload = createMessage("chat", [
          gameCode3,
          pubKey2,
          chatMessage,
          isBlack,
          isWhite,
          amount,
        ]);
        broadcastToGame(gameCode3, chatPayload);
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
      console.log(`firstPlayerIsWhite`);
      console.log(`whitePubKey: ${game.pubKeys[0]}`);
      console.log(`blackPubKey: ${game.pubKeys[1]}`);
      game.whitePubKey = game.pubKeys[0];
      game.blackPubKey = game.pubKeys[1];
    } else {
      console.log(`firstPlayerIsBlack`);
      console.log(`whitePubKey: ${game.pubKeys[1]}`);
      console.log(`blackPubKey: ${game.pubKeys[0]}`);
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

// Broadcasts a message to all players in a game
function broadcastToGame(gameCode, message) {
  const game = games[gameCode];
  if (game) {
    const payload = JSON.stringify(message);
    // Sending message to all players and observers in the game
    game.players.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
    (game.observers || []).forEach((observer) => {
      if (observer.readyState === WebSocket.OPEN) {
        observer.send(payload);
      }
    });
  }
}

// Function to declare the winner on the blockchain
async function declareWinnerOnBlockchain(gameId, winnerAddress) {
  try {
    const tx = await contract.declareWinner(gameId, winnerAddress);
    console.log("Transaction submitted:", tx.hash);
    const receipt = await tx.wait();
    console.log("Transaction confirmed:", receipt.blockNumber);
  } catch (error) {
    console.error("Failed to declare winner on blockchain:", error);
  }
}

// Function to return wagers on the blockchain
async function returnWagersOnBlockchain(gameId) {
  try {
    const tx = await contract.returnWagers(gameId);
    console.log("Transaction submitted:", tx.hash);
    const receipt = await tx.wait();
    console.log("Transaction confirmed:", receipt.blockNumber);
  } catch (error) {
    console.error("Failed to return wagers on blockchain:", error);
  }
}

console.log(`WebSocket server started on ws://127.0.0.1:${PORT}`);
