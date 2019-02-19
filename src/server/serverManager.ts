import { Connection, Server } from 'sockjs';
import { ErrorCode, GameMode, MessageToClient, MessageToServer, PlayerArrangementMode } from '../common/enums';
import { Game } from '../common/game';
import { GameSetup } from '../common/gameSetup';
import { gameModeToNumPlayers, getNewTileBag, isASCII } from '../common/helpers';
import { LogMessage } from './enums';
import { ReuseIDManager } from './reuseIDManager';
import { UserDataProvider } from './userDataProvider';

export enum ConnectionState {
  WaitingForFirstMessage,
  ProcessingFirstMessage,
  LoggedIn,
}

export class ServerManager {
  connectionIDToConnectionState = new Map<string, ConnectionState>();

  connectionIDToPreLoggedInConnection = new Map<string, Connection>();

  clientIDManager = new ReuseIDManager(60000);
  connectionIDToClient = new Map<string, Client>();
  userIDToUser = new Map<number, User>();

  gameDisplayNumberManager = new ReuseIDManager(60000);
  gameIDToGameData = new Map<number, GameData>();
  gameDisplayNumberToGameData = new Map<number, GameData>();

  onMessageFunctions: Map<MessageToServer, (client: Client, params: any[]) => void>;

  constructor(public server: Server, public userDataProvider: UserDataProvider, public nextGameID: number, public logger: (message: string) => void) {
    this.onMessageFunctions = new Map([
      [MessageToServer.CreateGame, this.onMessageCreateGame],
      [MessageToServer.EnterGame, this.onMessageEnterGame],
      [MessageToServer.ExitGame, this.onMessageExitGame],
      [MessageToServer.JoinGame, this.onMessageJoinGame],
      [MessageToServer.UnjoinGame, this.onMessageUnjoinGame],
      [MessageToServer.ApproveOfGameSetup, this.onMessageApproveOfGameSetup],
      [MessageToServer.ChangeGameMode, this.onMessageChangeGameMode],
      [MessageToServer.ChangePlayerArrangementMode, this.onMessageChangePlayerArrangementMode],
      [MessageToServer.SwapPositions, this.onMessageSwapPositions],
      [MessageToServer.KickUser, this.onMessageKickUser],
    ]);
  }

  manage() {
    this.server.on('connection', connection => {
      this.logger(
        JSON.stringify([
          LogMessage.Connected,
          connection.id,
          connection.headers,
          connection.pathname,
          connection.protocol,
          connection.remoteAddress,
          connection.remotePort,
        ]),
      );

      this.addConnection(connection);

      connection.on('data', messageString => {
        let message: any[];
        try {
          message = JSON.parse(messageString);
        } catch (error) {
          this.logger(JSON.stringify([LogMessage.MessageThatIsNotJSON, connection.id, messageString]));

          this.kickWithError(connection, ErrorCode.InvalidMessageFormat);
          return;
        }

        if (!Array.isArray(message)) {
          this.logger(JSON.stringify([LogMessage.MessageThatIsNotAnArray, connection.id, message]));

          this.kickWithError(connection, ErrorCode.InvalidMessageFormat);
          return;
        }

        const client = this.connectionIDToClient.get(connection.id);
        if (client !== undefined) {
          this.logger(JSON.stringify([LogMessage.MessageWhileLoggedIn, client.id, message]));
        } else {
          let sanitizedMessage = message;
          if (message[2] !== '') {
            sanitizedMessage = [...message];
            sanitizedMessage[2] = '***';
          }

          this.logger(JSON.stringify([LogMessage.MessageWhileNotLoggedIn, connection.id, sanitizedMessage]));
        }

        const connectionState = this.connectionIDToConnectionState.get(connection.id);

        if (connectionState === ConnectionState.LoggedIn && client !== undefined) {
          const handler = this.onMessageFunctions.get(message[0]);

          if (handler) {
            handler.call(this, client, message.slice(1));
          } else {
            this.kickWithError(connection, ErrorCode.InvalidMessage);
          }
        } else if (connectionState === ConnectionState.WaitingForFirstMessage) {
          this.connectionIDToConnectionState.set(connection.id, ConnectionState.ProcessingFirstMessage);

          // tslint:disable-next-line:no-floating-promises
          this.processFirstMessage(connection, message);
        }
      });

      connection.on('close', () => {
        const client = this.connectionIDToClient.get(connection.id);
        if (client !== undefined) {
          this.logger(JSON.stringify([LogMessage.Disconnected, connection.id, client.id, client.user.id, client.user.name]));
        } else {
          this.logger(JSON.stringify([LogMessage.Disconnected, connection.id]));
        }

        this.removeConnection(connection);
      });
    });
  }

  addConnection(connection: Connection) {
    this.connectionIDToConnectionState.set(connection.id, ConnectionState.WaitingForFirstMessage);
    this.connectionIDToPreLoggedInConnection.set(connection.id, connection);
  }

  removeConnection(connection: Connection) {
    const connectionState = this.connectionIDToConnectionState.get(connection.id);
    if (connectionState === undefined) {
      return;
    }

    this.connectionIDToConnectionState.delete(connection.id);

    if (connectionState === ConnectionState.LoggedIn) {
      const client = this.connectionIDToClient.get(connection.id);
      if (client === undefined) {
        return;
      }

      this.clientIDManager.returnID(client.id);

      this.connectionIDToClient.delete(connection.id);

      const user = client.user;
      user.clients.delete(client);
      this.deleteUserIfItDoesNotHaveReferences(user);

      const messageToOtherClients = JSON.stringify([this.getClientDisconnectedMessage(client)]);
      this.connectionIDToClient.forEach(otherClient => {
        otherClient.connection.write(messageToOtherClients);
      });
    } else {
      this.connectionIDToPreLoggedInConnection.delete(connection.id);
    }
  }

  kickWithError(connection: Connection, errorCode: ErrorCode) {
    this.logger(JSON.stringify([LogMessage.KickedWithError, connection.id, errorCode]));

    connection.write(JSON.stringify([[MessageToClient.FatalError, errorCode]]));
    connection.close();
  }

  async processFirstMessage(connection: Connection, message: any[]) {
    if (message.length !== 4) {
      this.kickWithError(connection, ErrorCode.InvalidMessageFormat);
      return;
    }

    const version: number = message[0];
    if (version !== 0) {
      this.kickWithError(connection, ErrorCode.NotUsingLatestVersion);
      return;
    }

    const username: string = message[1];
    if (username.length === 0 || username.length > 32 || !isASCII(username)) {
      this.kickWithError(connection, ErrorCode.InvalidUsername);
      return;
    }

    const password: string = message[2];
    if (typeof password !== 'string') {
      this.kickWithError(connection, ErrorCode.InvalidMessageFormat);
      return;
    }

    const gameDataArray: any[] = message[3];
    if (!Array.isArray(gameDataArray)) {
      this.kickWithError(connection, ErrorCode.InvalidMessageFormat);
      return;
    }

    let userData;
    try {
      userData = await this.userDataProvider.lookupUser(username);
    } catch (error) {
      this.kickWithError(connection, ErrorCode.InternalServerError);
      return;
    }

    let userID = 0;

    if (userData !== null) {
      if (userData.hasPassword) {
        if (password.length === 0) {
          this.kickWithError(connection, ErrorCode.MissingPassword);
          return;
        } else if (!userData.verifyPassword(password)) {
          this.kickWithError(connection, ErrorCode.IncorrectPassword);
          return;
        } else {
          userID = userData.userID;
        }
      } else {
        if (password.length > 0) {
          this.kickWithError(connection, ErrorCode.ProvidedPassword);
          return;
        } else {
          userID = userData.userID;
        }
      }
    } else {
      if (password.length > 0) {
        this.kickWithError(connection, ErrorCode.ProvidedPassword);
        return;
      } else {
        try {
          userID = await this.userDataProvider.createUser(username, null);
        } catch (error) {
          this.kickWithError(connection, ErrorCode.InternalServerError);
          return;
        }
      }
    }

    this.connectionIDToConnectionState.set(connection.id, ConnectionState.LoggedIn);

    this.connectionIDToPreLoggedInConnection.delete(connection.id);

    let user = this.userIDToUser.get(userID);
    let isNewUser = false;
    if (user === undefined) {
      user = new User(userID, username);
      this.userIDToUser.set(userID, user);
      isNewUser = true;
    }

    const client = new Client(this.clientIDManager.getID(), connection, user);
    this.connectionIDToClient.set(connection.id, client);
    user.clients.add(client);

    client.connection.write(JSON.stringify([this.getGreetingsMessage(gameDataArray, client)]));

    const messageToOtherClients = JSON.stringify([this.getClientConnectedMessage(client, isNewUser)]);
    this.connectionIDToClient.forEach(otherClient => {
      if (otherClient !== client) {
        otherClient.connection.write(messageToOtherClients);
      }
    });

    this.logger(JSON.stringify([LogMessage.LoggedIn, connection.id, client.id, userID, username]));
  }

  onMessageCreateGame(client: Client, params: any[]) {
    if (params.length !== 1) {
      this.kickWithError(client.connection, ErrorCode.InvalidMessage);
      return;
    }

    const gameMode: GameMode = params[0];
    if (!gameModeToNumPlayers.has(gameMode)) {
      this.kickWithError(client.connection, ErrorCode.InvalidMessage);
      return;
    }

    if (client.gameData !== null) {
      return;
    }

    const gameData = new GameData(this.nextGameID++, this.gameDisplayNumberManager.getID());
    gameData.gameSetup = new GameSetup(gameMode, PlayerArrangementMode.RandomOrder, client.user.id, this.getUsernameForUserID);
    gameData.clients.add(client);

    client.gameData = gameData;
    client.user.numGames++;

    this.gameIDToGameData.set(gameData.id, gameData);
    this.gameDisplayNumberToGameData.set(gameData.displayNumber, gameData);

    const message = JSON.stringify([this.getGameCreatedMessage(gameData, client), this.getClientEnteredGameMessage(gameData, client)]);
    this.connectionIDToClient.forEach(aClient => {
      aClient.connection.write(message);
    });
  }

  onMessageEnterGame(client: Client, params: any[]) {
    if (params.length !== 1) {
      this.kickWithError(client.connection, ErrorCode.InvalidMessage);
      return;
    }

    const gameDisplayNumber: number = params[0];
    const gameData = this.gameDisplayNumberToGameData.get(gameDisplayNumber);
    if (gameData === undefined) {
      this.kickWithError(client.connection, ErrorCode.InvalidMessage);
      return;
    }

    if (client.gameData !== null) {
      return;
    }

    gameData.clients.add(client);

    client.gameData = gameData;

    const message = JSON.stringify([this.getClientEnteredGameMessage(gameData, client)]);
    this.connectionIDToClient.forEach(aClient => {
      aClient.connection.write(message);
    });
  }

  onMessageExitGame(client: Client, params: any[]) {
    if (params.length !== 0) {
      this.kickWithError(client.connection, ErrorCode.InvalidMessage);
      return;
    }

    const gameData = client.gameData;
    if (gameData === null) {
      return;
    }

    gameData.clients.delete(client);

    client.gameData = null;

    const message = JSON.stringify([this.getClientExitedGameMessage(client)]);
    this.connectionIDToClient.forEach(aClient => {
      aClient.connection.write(message);
    });
  }

  onMessageJoinGame(client: Client, params: any[]) {
    const gameData = client.gameData;
    if (gameData === null) {
      return;
    }

    const gameSetup = gameData.gameSetup;
    if (gameSetup === null) {
      return;
    }

    if (params.length !== 0) {
      this.kickWithError(client.connection, ErrorCode.InvalidMessage);
      return;
    }

    gameSetup.addUser(client.user.id);

    if (gameSetup.history.length > 0) {
      client.user.numGames++;

      this.sendGameSetupChanges(gameData);
    }
  }

  onMessageUnjoinGame(client: Client, params: any[]) {
    const gameData = client.gameData;
    if (gameData === null) {
      return;
    }

    const gameSetup = gameData.gameSetup;
    if (gameSetup === null) {
      return;
    }

    if (params.length !== 0) {
      this.kickWithError(client.connection, ErrorCode.InvalidMessage);
      return;
    }

    gameSetup.removeUser(client.user.id);

    if (gameSetup.history.length > 0) {
      client.user.numGames--;
      this.deleteUserIfItDoesNotHaveReferences(client.user);

      this.sendGameSetupChanges(gameData);
    }
  }

  onMessageApproveOfGameSetup(client: Client, params: any[]) {
    const gameData = client.gameData;
    if (gameData === null) {
      return;
    }

    const gameSetup = gameData.gameSetup;
    if (gameSetup === null) {
      return;
    }

    if (params.length !== 0) {
      this.kickWithError(client.connection, ErrorCode.InvalidMessage);
      return;
    }

    gameSetup.approve(client.user.id);

    if (gameSetup.approvedByEverybody) {
      const [userIDs, usernames] = gameSetup.getFinalUserIDsAndUsernames();

      const game = new Game(gameSetup.gameMode, gameSetup.playerArrangementMode, getNewTileBag(), userIDs, usernames, gameSetup.hostUserID, null);
      gameData.gameSetup = null;
      gameData.game = game;

      const message = JSON.stringify([[MessageToClient.GameStarted, gameData.displayNumber, userIDs.toJS()]]);
      this.connectionIDToClient.forEach(aClient => {
        aClient.connection.write(message);
      });

      game.doGameAction([], Date.now());
      this.sendLastGameMoveDataMessage(gameData);
    } else if (gameSetup.history.length > 0) {
      this.sendGameSetupChanges(gameData);
    }
  }

  onMessageChangeGameMode(client: Client, params: any[]) {
    const gameData = client.gameData;
    if (gameData === null) {
      return;
    }

    const gameSetup = gameData.gameSetup;
    if (gameSetup === null) {
      return;
    }

    if (client.user.id !== gameSetup.hostUserID) {
      this.kickWithError(client.connection, ErrorCode.InvalidMessage);
      return;
    }

    if (params.length !== gameSetup.changeGameMode.length) {
      this.kickWithError(client.connection, ErrorCode.InvalidMessage);
      return;
    }

    gameSetup.changeGameMode(params[0]);

    if (gameSetup.history.length > 0) {
      this.sendGameSetupChanges(gameData);
    }
  }

  onMessageChangePlayerArrangementMode(client: Client, params: any[]) {
    const gameData = client.gameData;
    if (gameData === null) {
      return;
    }

    const gameSetup = gameData.gameSetup;
    if (gameSetup === null) {
      return;
    }

    if (client.user.id !== gameSetup.hostUserID) {
      this.kickWithError(client.connection, ErrorCode.InvalidMessage);
      return;
    }

    if (params.length !== gameSetup.changePlayerArrangementMode.length) {
      this.kickWithError(client.connection, ErrorCode.InvalidMessage);
      return;
    }

    gameSetup.changePlayerArrangementMode(params[0]);

    if (gameSetup.history.length > 0) {
      this.sendGameSetupChanges(gameData);
    }
  }

  onMessageSwapPositions(client: Client, params: any[]) {
    const gameData = client.gameData;
    if (gameData === null) {
      return;
    }

    const gameSetup = gameData.gameSetup;
    if (gameSetup === null) {
      return;
    }

    if (client.user.id !== gameSetup.hostUserID) {
      this.kickWithError(client.connection, ErrorCode.InvalidMessage);
      return;
    }

    if (params.length !== gameSetup.swapPositions.length) {
      this.kickWithError(client.connection, ErrorCode.InvalidMessage);
      return;
    }

    gameSetup.swapPositions(params[0], params[1]);

    if (gameSetup.history.length > 0) {
      this.sendGameSetupChanges(gameData);
    }
  }

  onMessageKickUser(client: Client, params: any[]) {
    const gameData = client.gameData;
    if (gameData === null) {
      return;
    }

    const gameSetup = gameData.gameSetup;
    if (gameSetup === null) {
      return;
    }

    if (client.user.id !== gameSetup.hostUserID) {
      this.kickWithError(client.connection, ErrorCode.InvalidMessage);
      return;
    }

    if (params.length !== gameSetup.kickUser.length) {
      this.kickWithError(client.connection, ErrorCode.InvalidMessage);
      return;
    }

    gameSetup.kickUser(params[0]);

    if (gameSetup.history.length > 0) {
      const user = this.userIDToUser.get(params[0])!;
      user.numGames--;
      this.deleteUserIfItDoesNotHaveReferences(user);

      this.sendGameSetupChanges(gameData);
    }
  }

  sendGameSetupChanges(gameData: GameData) {
    const gameSetup = gameData.gameSetup!;

    const message = JSON.stringify(gameSetup.history.map(change => [MessageToClient.GameSetupChanged, gameData.displayNumber, ...change]));
    this.connectionIDToClient.forEach(aClient => {
      aClient.connection.write(message);
    });

    gameSetup.clearHistory();
  }

  sendLastGameMoveDataMessage(gameData: GameData) {
    const game = gameData.game!;
    const moveData = game.moveDataHistory.get(game.moveDataHistory.size - 1)!;

    moveData.createPlayerAndWatcherMessages();

    const playerUserIDs = new Set<number>();

    // send player messages
    game.userIDs.forEach((userID, playerID) => {
      const user = this.userIDToUser.get(userID)!;
      if (user.clients.size > 0) {
        const message = JSON.stringify([[MessageToClient.GameActionDone, gameData.displayNumber, ...moveData.playerMessages[playerID]]]);
        user.clients.forEach(aClient => {
          aClient.connection.write(message);
        });
      }

      playerUserIDs.add(userID);
    });

    // send watcher messages to everybody else
    const watcherMessage = JSON.stringify([[MessageToClient.GameActionDone, gameData.displayNumber, ...moveData.watcherMessage]]);
    this.connectionIDToClient.forEach(aClient => {
      if (!playerUserIDs.has(aClient.user.id)) {
        aClient.connection.write(watcherMessage);
      }
    });
  }

  getGreetingsMessage(_gameDataArray: any[], client: Client) {
    const users: any[] = [];
    this.userIDToUser.forEach(user => {
      const clients: any[] = [];
      user.clients.forEach(aClient => {
        const clientData = [aClient.id];
        if (aClient.gameData !== null) {
          clientData.push(aClient.gameData.displayNumber);
        }
        clients.push(clientData);
      });

      const userMessage: any[] = [user.id, user.name];
      if (clients.length > 0) {
        userMessage.push(clients);
      }

      users.push(userMessage);
    });

    const games: any[] = [];
    this.gameIDToGameData.forEach(gameData => {
      const message: any[] = [gameData.gameSetup !== null ? 0 : 1, gameData.id, gameData.displayNumber];
      if (gameData.gameSetup !== null) {
        message.push(...gameData.gameSetup.toJSON());
      }
      games.push(message);
    });

    return [MessageToClient.Greetings, client.id, users, games];
  }

  getClientConnectedMessage(client: Client, isNewUser: boolean) {
    const message: any[] = [MessageToClient.ClientConnected, client.id, client.user.id];
    if (isNewUser) {
      message.push(client.user.name);
    }

    return message;
  }

  getClientDisconnectedMessage(client: Client) {
    return [MessageToClient.ClientDisconnected, client.id];
  }

  getGameCreatedMessage(gameData: GameData, hostClient: Client) {
    return [MessageToClient.GameCreated, gameData.id, gameData.displayNumber, gameData.gameSetup!.gameMode, hostClient.id];
  }

  getClientEnteredGameMessage(gameData: GameData, client: Client) {
    return [MessageToClient.ClientEnteredGame, client.id, gameData.displayNumber];
  }

  getClientExitedGameMessage(client: Client) {
    return [MessageToClient.ClientExitedGame, client.id];
  }

  getUsernameForUserID = (userID: number) => {
    return this.userIDToUser.get(userID)!.name;
  };

  deleteUserIfItDoesNotHaveReferences(user: User) {
    if (user.clients.size === 0 && user.numGames === 0) {
      this.userIDToUser.delete(user.id);
    }
  }
}

export class Client {
  gameData: GameData | null = null;

  constructor(public id: number, public connection: Connection, public user: User) {}
}

export class User {
  clients = new Set<Client>();

  numGames = 0;

  constructor(public id: number, public name: string) {}
}

export class GameData {
  gameSetup: GameSetup | null = null;
  game: Game | null = null;

  clients = new Set<Client>();

  constructor(public id: number, public displayNumber: number) {}
}
