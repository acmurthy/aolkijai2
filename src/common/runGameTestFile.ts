import { List } from 'immutable';
import { GameActionEnum, GameHistoryMessageEnum, ScoreBoardIndexEnum, TileEnum } from './enums';
import { UserInputError } from './error';
import { Game, GameHistoryMessageData, GameState, GameStateTileBagTile } from './game';
import { ActionBase } from './gameActions/base';
import { ActionDisposeOfShares } from './gameActions/disposeOfShares';
import { ActionGameOver } from './gameActions/gameOver';
import { ActionSelectChainToDisposeOfNext } from './gameActions/selectChainToDisposeOfNext';
import { ActionSelectMergerSurvivor } from './gameActions/selectMergerSurvivor';
import { ActionSelectNewChain } from './gameActions/selectNewChain';
import { getValueOfKey, lowercaseFirstLetter } from './helpers';
import {
  GameBoardType,
  GameMode,
  PB_GameAction,
  PB_GameAction_DisposeOfShares,
  PB_GameAction_PlayTile,
  PB_GameAction_PurchaseShares,
  PB_GameAction_SelectChainToDisposeOfNext,
  PB_GameAction_SelectMergerSurvivor,
  PB_GameAction_SelectNewChain,
  PB_GameStateData,
  PB_GameStateData_RevealedTileRackTile,
  PlayerArrangementMode,
} from './pb';

export function runGameTestFile(inputLines: string[]) {
  let game: Game | null = null;
  let gameMode = GameMode.SINGLES_1;
  let playerArrangementMode = PlayerArrangementMode.VERSION_1;
  let tileBag: number[] = [];
  const userIDs: number[] = [];
  const usernames: string[] = [];
  let hostUserID = 0;
  let myUserID: number | null = null;

  const outputLines: string[] = [];

  let myPlayerID: number | null = null;
  let lastGameState: GameState | null = null;
  let timestamp: number | null = null;

  for (let lineNumber = 0; lineNumber < inputLines.length; lineNumber++) {
    const line = inputLines[lineNumber];
    if (game === null) {
      if (line.length > 0) {
        const parts = line.split(': ');
        const key = parts[0];
        const value = parts.slice(1).join(': ');
        switch (key) {
          case 'game mode':
            // @ts-ignore
            gameMode = GameMode[value];
            break;
          case 'player arrangement mode':
            // @ts-ignore
            playerArrangementMode = PlayerArrangementMode[value];
            break;
          case 'tile bag': {
            tileBag = fromTilesString(value);

            const duplicatedTiles = getDuplicatedTiles(tileBag);
            if (duplicatedTiles.length > 0) {
              outputLines.push(`duplicated tiles in tile bag: ${toTilesString(duplicatedTiles)}`);
            }
            break;
          }
          case 'user': {
            const userParts = value.split(' ');
            userIDs.push(parseInt(userParts[0], 10));
            usernames.push(userParts.slice(1).join(' '));
            break;
          }
          case 'host':
            hostUserID = parseInt(value, 10);
            break;
          case 'me':
            myUserID = value === 'null' ? null : parseInt(value, 10);
            break;
          default:
            outputLines.push(`unrecognized line: ${line}`);
            break;
        }
      } else {
        outputLines.push(`game mode: ${GameMode[gameMode]}`);
        outputLines.push(`player arrangement mode: ${PlayerArrangementMode[playerArrangementMode]}`);
        if (tileBag.length > 0) {
          outputLines.push(`tile bag: ${toTilesString(tileBag)}`);
        }
        for (let i = 0; i < userIDs.length; i++) {
          const userID = userIDs[i];
          const username = usernames[i];
          outputLines.push(`user: ${userID} ${username}`);
        }
        outputLines.push(`host: ${hostUserID}`);
        if (myUserID !== null) {
          outputLines.push(`me: ${myUserID}`);
        }

        game = new Game(gameMode, playerArrangementMode, tileBag, List(userIDs), List(usernames), hostUserID, myUserID);

        if (myUserID !== null) {
          myPlayerID = userIDs.indexOf(myUserID);
        }
      }
    } else {
      const lineParts = line.split(': ');

      if (lastGameState !== null) {
        outputLines.push(...getGameStateLines(lastGameState, myPlayerID, line !== ''));
        lastGameState = null;
      }

      if (lineParts[0] === 'revealed tile rack tiles') {
        game.processRevealedTileRackTiles(getArrayFromRevealedTileRackTilesString(lineParts[1]));
      } else if (lineParts[0] === 'revealed tile bag tiles') {
        game.processRevealedTileBagTiles(fromTilesString(lineParts[1]));
      } else if (lineParts[0] === 'player ID with playable tile') {
        game.processPlayerIDWithPlayableTile(parseInt(lineParts[1], 10));
      } else if (lineParts[0] === 'timestamp') {
        timestamp = parseInt(lineParts[1], 10);
      } else if (lineParts[0] === 'action') {
        const actionParts = lineParts[1].split(' ');

        const actualGameActionName = game.gameActionStack[game.gameActionStack.length - 1].constructor.name.slice(6);
        // @ts-ignore actualGameActionName is in PB_GameAction
        const actualGameAction: GameActionEnum = GameActionEnum[actualGameActionName];

        let gameAction: PB_GameAction;
        let usingJSONParameters = false;
        if (actionParts.length > 2) {
          if (actionParts[2] === '--') {
            usingJSONParameters = true;
            const json = actionParts.slice(3).join(' ');
            let parsedJson;
            try {
              parsedJson = JSON.parse(json);
            } catch (error) {
              expect(false).toBe(true);
            }
            gameAction = PB_GameAction.create({ [lowercaseFirstLetter(actualGameActionName)]: parsedJson });
          } else {
            gameAction = fromParameterStrings(actualGameAction, actionParts.slice(2));
          }
        } else {
          gameAction = PB_GameAction.create({ [lowercaseFirstLetter(actualGameActionName)]: {} });
        }

        outputLines.push('');

        try {
          game.doGameAction(gameAction, timestamp);
          lastGameState = game.gameStateHistory.get(game.gameStateHistory.size - 1, null);
        } catch (error) {
          if (error instanceof UserInputError) {
            let stringParameters = '';
            if (usingJSONParameters) {
              stringParameters = ` -- ${JSON.stringify(getValueOfKey(gameAction))}`;
            } else {
              const arr = toParameterStrings(gameAction);
              if (arr.length > 0) {
                stringParameters = ` ${arr.join(' ')}`;
              }
            }

            if (timestamp !== null) {
              outputLines.push(`timestamp: ${timestamp}`);
            }
            outputLines.push(
              `action: ${game.gameStateHistory.get(game.gameStateHistory.size - 1)!.nextGameAction.playerID} ${actualGameActionName}${stringParameters}`,
            );
            outputLines.push(`  error: ${error.message}`);
          } else {
            outputLines.push(`line with unknown error: ${line}`);
            outputLines.push(`  unknown error: ${error.toString()}`);
            if (error instanceof Error) {
              outputLines.push(`  stack trace: ${error.stack}`);
            }
          }
        }

        timestamp = null;
      } else if (line === 'Game JSON:') {
        break;
      }
    }
  }

  if (game !== null) {
    outputLines.push('');
    outputLines.push('Game JSON:');
    outputLines.push(...getFormattedGameJSONLines(game));
  }

  outputLines.push('');

  return { outputLines, game };
}

function getDuplicatedTiles(tileBag: number[]) {
  const tiles = new Set<number>();
  const duplicatedTiles = new Set<number>();
  for (let i = 0; i < tileBag.length; i++) {
    const tile = tileBag[i];
    if (tiles.has(tile)) {
      duplicatedTiles.add(tile);
    }
    tiles.add(tile);
  }

  return [...duplicatedTiles.values()];
}

const abbreviationToGameBoardType = new Map([
  ['L', GameBoardType.LUXOR],
  ['T', GameBoardType.TOWER],
  ['A', GameBoardType.AMERICAN],
  ['F', GameBoardType.FESTIVAL],
  ['W', GameBoardType.WORLDWIDE],
  ['C', GameBoardType.CONTINENTAL],
  ['I', GameBoardType.IMPERIAL],
]);

function fromParameterStrings(gameActionEnum: GameActionEnum, strings: string[]) {
  const gameAction = PB_GameAction.create();

  switch (gameActionEnum) {
    case GameActionEnum.PlayTile: {
      const playTile = PB_GameAction_PlayTile.create();
      playTile.tile = fromTileString(strings[0]);
      gameAction.playTile = playTile;
      break;
    }
    case GameActionEnum.SelectNewChain: {
      const selectNewChain = PB_GameAction_SelectNewChain.create();
      selectNewChain.chain = abbreviationToGameBoardType.get(strings[0])!;
      gameAction.selectNewChain = selectNewChain;
      break;
    }
    case GameActionEnum.SelectMergerSurvivor: {
      const selectMergerSurvivor = PB_GameAction_SelectMergerSurvivor.create();
      selectMergerSurvivor.chain = abbreviationToGameBoardType.get(strings[0])!;
      gameAction.selectMergerSurvivor = selectMergerSurvivor;
      break;
    }
    case GameActionEnum.SelectChainToDisposeOfNext: {
      const selectChainToDisposeOfNext = PB_GameAction_SelectChainToDisposeOfNext.create();
      selectChainToDisposeOfNext.chain = abbreviationToGameBoardType.get(strings[0])!;
      gameAction.selectChainToDisposeOfNext = selectChainToDisposeOfNext;
      break;
    }
    case GameActionEnum.DisposeOfShares: {
      const disposeOfShares = PB_GameAction_DisposeOfShares.create();
      disposeOfShares.tradeAmount = parseInt(strings[0], 10);
      disposeOfShares.sellAmount = parseInt(strings[1], 10);
      gameAction.disposeOfShares = disposeOfShares;
      break;
    }
    case GameActionEnum.PurchaseShares: {
      const purchaseShares = PB_GameAction_PurchaseShares.create();
      if (strings[0] !== 'x') {
        purchaseShares.chains = strings[0].split(',').map((s) => abbreviationToGameBoardType.get(s)!);
      }
      purchaseShares.endGame = strings[1] === '1';
      gameAction.purchaseShares = purchaseShares;
      break;
    }
  }

  return gameAction;
}

function toParameterStrings(gameAction: PB_GameAction) {
  const strings: any[] = [];

  if (gameAction.playTile) {
    strings.push(toTileString(gameAction.playTile.tile!));
  } else if (gameAction.selectNewChain) {
    strings.push(gameBoardTypeToCharacter.get(gameAction.selectNewChain.chain!)!);
  } else if (gameAction.selectMergerSurvivor) {
    strings.push(gameBoardTypeToCharacter.get(gameAction.selectMergerSurvivor.chain!)!);
  } else if (gameAction.selectChainToDisposeOfNext) {
    strings.push(gameBoardTypeToCharacter.get(gameAction.selectChainToDisposeOfNext.chain!)!);
  } else if (gameAction.disposeOfShares) {
    strings.push(gameAction.disposeOfShares.tradeAmount?.toString());
    strings.push(gameAction.disposeOfShares.sellAmount?.toString());
  } else if (gameAction.purchaseShares) {
    if (gameAction.purchaseShares.chains!.length === 0) {
      strings.push('x');
    } else {
      strings.push(gameAction.purchaseShares.chains!.map((p: number) => gameBoardTypeToCharacter.get(p)).join(','));
    }
    strings.push(gameAction.purchaseShares.endGame ? '1' : '0');
  }

  return strings;
}

const gameBoardStringSpacer = '            ';

function getGameStateLines(gameState: GameState, revealedTilesPlayerID: number | null, detailed: boolean) {
  const lines: string[] = [];

  if (revealedTilesPlayerID !== null) {
    const rtrtStr = getRevealedTileRackTilesStringForPlayer(gameState.revealedTileRackTiles, revealedTilesPlayerID);
    if (rtrtStr.length > 0) {
      lines.push(`revealed tile rack tiles: ${rtrtStr}`);
    }

    const rtbtStr = getRevealedTileBagTilesStringForPlayer(gameState.revealedTileBagTiles, revealedTilesPlayerID);
    if (rtbtStr.length > 0) {
      lines.push(`revealed tile bag tiles: ${rtbtStr}`);
    }

    if (gameState.playerIDWithPlayableTile !== null) {
      lines.push(`player ID with playable tile: ${gameState.playerIDWithPlayableTile}`);
    }
  }

  if (gameState.timestamp !== null) {
    lines.push(`timestamp: ${gameState.timestamp}`);
  }

  const arr = toParameterStrings(gameState.gameAction);
  let stringParameters = '';
  if (arr.length > 0) {
    stringParameters = ` ${arr.join(' ')}`;
  }
  lines.push(`action: ${gameState.playerID} ${GameActionEnum[gameState.gameActionEnum]}${stringParameters}`);

  if (detailed) {
    const gameBoardLines = getGameBoardLines(gameState.gameBoard);
    const scoreBoardLines = getScoreBoardLines(
      gameState.scoreBoard,
      gameState.scoreBoardAvailable,
      gameState.scoreBoardChainSize,
      gameState.scoreBoardPrice,
      gameState.nextGameAction instanceof ActionGameOver ? -1 : gameState.turnPlayerID,
      gameState.nextGameAction instanceof ActionGameOver ? -1 : gameState.nextGameAction.playerID,
    );
    const numLines = Math.max(gameBoardLines.length, scoreBoardLines.length);
    for (let i = 0; i < numLines; i++) {
      const lineParts = [];
      lineParts.push(i < gameBoardLines.length ? gameBoardLines[i] : gameBoardStringSpacer);
      if (i < scoreBoardLines.length) {
        lineParts.push('  ');
        lineParts.push(scoreBoardLines[i]);
      }
      lines.push(`  ${lineParts.join('')}`);
    }

    lines.push('  tile racks:');
    gameState.tileRacks.forEach((tileRack, playerID) => {
      const tileTypes = gameState.tileRackTypes.get(playerID)!;
      lines.push(`    ${playerID}: ${getTileRackString(tileRack, tileTypes)}`);
    });

    if (gameState.revealedTileRackTiles.length > 0) {
      const str = gameState.revealedTileRackTiles
        .map((trt) => {
          return `${toTileString(trt.tile)}:${trt.playerIdBelongsTo.toString()}`;
        })
        .join(', ');
      lines.push(`  revealed tile rack tiles: ${str}`);
    }

    if (gameState.revealedTileBagTiles.length > 0) {
      const str = gameState.revealedTileBagTiles
        .map((tbt) => {
          return `${toTileString(tbt.tile)}:${tbt.playerIDWithPermission === null ? 'all' : tbt.playerIDWithPermission.toString()}`;
        })
        .join(', ');
      lines.push(`  revealed tile bag tiles: ${str}`);
    }

    if (gameState.playerIDWithPlayableTile !== null) {
      lines.push(`  player ID with playable tile: ${gameState.playerIDWithPlayableTile}`);
    }

    lines.push('  messages:');
    gameState.createPlayerAndWatcherGameStateDatas();
    for (let playerID = 0; playerID < gameState.playerGameStateDatas.length; playerID++) {
      lines.push(`    ${playerID}: ${formatPlayerOrWatcherGameStateData(gameState.playerGameStateDatas[playerID])}`);
    }
    lines.push(`    w: ${formatPlayerOrWatcherGameStateData(gameState.watcherGameStateData)}`);

    lines.push('  history messages:');
    gameState.gameHistoryMessages.forEach((ghm) => {
      lines.push(`    ${getGameHistoryMessageString(ghm)}`);
    });

    lines.push(`  next action: ${getNextActionString(gameState.nextGameAction)}`);
  }

  return lines;
}

function getRevealedTileRackTilesStringForPlayer(revealedTileRackTiles: PB_GameStateData_RevealedTileRackTile[], playerID: number) {
  const parts: string[] = [];

  for (let i = 0; i < revealedTileRackTiles.length; i++) {
    const rtrt = revealedTileRackTiles[i];
    if (rtrt.playerIdBelongsTo !== playerID) {
      parts.push(`${toTileString(rtrt.tile)}:${rtrt.playerIdBelongsTo}`);
    }
  }

  return parts.join(', ');
}

function formatPlayerOrWatcherGameStateData(gameStateData: PB_GameStateData) {
  return JSON.stringify({
    gameAction: gameStateData.gameAction,
    timestamp: gameStateData.timestamp !== 0 ? gameStateData.timestamp : undefined,
    revealedTileRackTiles: gameStateData.revealedTileRackTiles.length > 0 ? gameStateData.revealedTileRackTiles : undefined,
    revealedTileBagTiles: gameStateData.revealedTileBagTiles.length > 0 ? gameStateData.revealedTileBagTiles : undefined,
    playerIdWithPlayableTilePlusOne: gameStateData.playerIdWithPlayableTilePlusOne >= 1 ? gameStateData.playerIdWithPlayableTilePlusOne : undefined,
  }).replace(/"chains":\[\],/g, '');
}

function getArrayFromRevealedTileRackTilesString(revealedTileRackTilesString: string) {
  const strParts = revealedTileRackTilesString.split(', ');
  const revealedTileRackTiles: PB_GameStateData_RevealedTileRackTile[] = new Array(strParts.length);

  for (let i = 0; i < strParts.length; i++) {
    const [tileStr, playerIDStr] = strParts[i].split(':');

    const revealedTileRackTile = PB_GameStateData_RevealedTileRackTile.create({
      tile: fromTileString(tileStr),
      playerIdBelongsTo: parseInt(playerIDStr, 10),
    });

    revealedTileRackTiles[i] = revealedTileRackTile;
  }

  return revealedTileRackTiles;
}

function getRevealedTileBagTilesStringForPlayer(revealedTileBagTiles: GameStateTileBagTile[], playerID: number) {
  const parts: string[] = [];

  for (let i = 0; i < revealedTileBagTiles.length; i++) {
    const rtbt = revealedTileBagTiles[i];
    const tile = rtbt.playerIDWithPermission === null || rtbt.playerIDWithPermission === playerID ? rtbt.tile : TileEnum.Unknown;
    parts.push(toTileString(tile));
  }

  return parts.join(', ');
}

const gameBoardTypeToCharacter = new Map([
  [GameBoardType.LUXOR, 'L'],
  [GameBoardType.TOWER, 'T'],
  [GameBoardType.AMERICAN, 'A'],
  [GameBoardType.FESTIVAL, 'F'],
  [GameBoardType.WORLDWIDE, 'W'],
  [GameBoardType.CONTINENTAL, 'C'],
  [GameBoardType.IMPERIAL, 'I'],
  [GameBoardType.NOTHING, '·'],
  [GameBoardType.NOTHING_YET, 'O'],
  [GameBoardType.CANT_PLAY_EVER, '█'],
  [GameBoardType.I_HAVE_THIS, 'i'],
  [GameBoardType.WILL_PUT_LONELY_TILE_DOWN, 'l'],
  [GameBoardType.HAVE_NEIGHBORING_TILE_TOO, 'h'],
  [GameBoardType.WILL_FORM_NEW_CHAIN, 'n'],
  [GameBoardType.WILL_MERGE_CHAINS, 'm'],
  [GameBoardType.CANT_PLAY_NOW, 'c'],
]);
function getGameBoardLines(gameBoard: List<List<GameBoardType>>) {
  const lines: string[] = new Array(9);
  const chars: string[] = new Array(12);
  for (let y = 0; y < 9; y++) {
    for (let x = 0; x < 12; x++) {
      chars[x] = gameBoardTypeToCharacter.get(gameBoard.get(y)!.get(x)!)!;
    }
    lines[y] = chars.join('');
  }
  return lines;
}

function getScoreBoardLines(
  scoreBoard: List<List<number>>,
  scoreBoardAvailable: List<number>,
  scoreBoardChainSize: List<number>,
  scoreBoardPrice: List<number>,
  turnPlayerID: number,
  movePlayerID: number,
) {
  const lines: string[] = [];
  lines.push(formatScoreBoardLine(['P', 'L', 'T', 'A', 'F', 'W', 'C', 'I', 'Cash', 'Net']));
  scoreBoard.forEach((row, playerID) => {
    let name: string;
    if (playerID === turnPlayerID) {
      name = 'T';
    } else if (playerID === movePlayerID) {
      name = 'M';
    } else {
      name = '';
    }
    lines.push(formatScoreBoardLine([name, ...row.toArray().map((val, index) => (index <= ScoreBoardIndexEnum.Imperial && val === 0 ? '' : val.toString()))]));
  });
  lines.push(formatScoreBoardLine(['A', ...scoreBoardAvailable.toArray().map((val) => val.toString())]));
  lines.push(formatScoreBoardLine(['C', ...scoreBoardChainSize.toArray().map((val) => (val === 0 ? '-' : val.toString()))]));
  lines.push(formatScoreBoardLine(['P', ...scoreBoardPrice.toArray().map((val) => (val === 0 ? '-' : val.toString()))]));
  return lines;
}

const scoreBoardColumnWidths = [1, 2, 2, 2, 2, 2, 2, 2, 4, 4];
function formatScoreBoardLine(entries: string[]) {
  const lineParts = entries.map((entry, index) => {
    const numSpacesToAdd = scoreBoardColumnWidths[index] - entry.length;
    if (numSpacesToAdd > 0) {
      entry = ' '.repeat(numSpacesToAdd) + entry;
    }
    return entry;
  });
  return lineParts.join(' ');
}

function getTileRackString(tiles: List<number | null>, tileTypes: List<GameBoardType | null>) {
  return tiles
    .map((tile, tileIndex) => {
      if (tile === TileEnum.Unknown) {
        return '?';
      }

      const tileType = tileTypes.get(tileIndex, null);
      if (tile !== null && tileType !== null) {
        return `${toTileString(tile)}(${gameBoardTypeToCharacter.get(tileType)})`;
      } else {
        return 'none';
      }
    })
    .join(' ');
}

function toTilesString(tiles: number[]) {
  return tiles.map(toTileString).join(', ');
}

function fromTilesString(str: string) {
  return str.split(', ').map(fromTileString);
}

const yTileNames = 'ABCDEFGHI';

function toTileString(tile: number) {
  if (tile === TileEnum.Unknown) {
    return '?';
  } else {
    return `${Math.floor(tile / 9) + 1}${yTileNames[tile % 9]}`;
  }
}

function fromTileString(str: string) {
  if (str === '?') {
    return TileEnum.Unknown;
  } else {
    const x = parseInt(str.slice(0, str.length - 1), 10) - 1;
    const y = yTileNames.indexOf(str.slice(str.length - 1));
    return x * 9 + y;
  }
}

const ghmsh = (ghmd: GameHistoryMessageData) => {
  return GameHistoryMessageEnum[ghmd.gameHistoryMessage];
};
const ghmshPlayerID = (ghmd: GameHistoryMessageData) => {
  return [ghmd.playerID, GameHistoryMessageEnum[ghmd.gameHistoryMessage]].join(' ');
};
const ghmshPlayerIDTile = (ghmd: GameHistoryMessageData) => {
  return [ghmd.playerID, GameHistoryMessageEnum[ghmd.gameHistoryMessage], toTileString(ghmd.parameters[0])].join(' ');
};
const ghmshPlayerIDType = (ghmd: GameHistoryMessageData) => {
  return [ghmd.playerID, GameHistoryMessageEnum[ghmd.gameHistoryMessage], GameBoardType[ghmd.parameters[0]][0], ...ghmd.parameters.slice(1)].join(' ');
};
const ghmshMergedChains = (ghmd: GameHistoryMessageData) => {
  return [ghmd.playerID, GameHistoryMessageEnum[ghmd.gameHistoryMessage], ghmd.parameters[0].map((x: GameBoardType) => GameBoardType[x][0]).join(',')].join(
    ' ',
  );
};
const ghmshPurchasedShares = (ghmd: GameHistoryMessageData) => {
  return [
    ghmd.playerID,
    GameHistoryMessageEnum[ghmd.gameHistoryMessage],
    ghmd.parameters[0].length > 0
      ? ghmd.parameters[0].map(([type, count]: [ScoreBoardIndexEnum, number]) => `${count}${GameBoardType[type][0]}`).join(',')
      : 'x',
  ].join(' ');
};

const gameHistoryMessageStringHandlers = new Map([
  [GameHistoryMessageEnum.TurnBegan, ghmshPlayerID],
  [GameHistoryMessageEnum.DrewPositionTile, ghmshPlayerIDTile],
  [GameHistoryMessageEnum.StartedGame, ghmshPlayerID],
  [GameHistoryMessageEnum.DrewTile, ghmshPlayerIDTile],
  [GameHistoryMessageEnum.HasNoPlayableTile, ghmshPlayerID],
  [GameHistoryMessageEnum.PlayedTile, ghmshPlayerIDTile],
  [GameHistoryMessageEnum.FormedChain, ghmshPlayerIDType],
  [GameHistoryMessageEnum.MergedChains, ghmshMergedChains],
  [GameHistoryMessageEnum.SelectedMergerSurvivor, ghmshPlayerIDType],
  [GameHistoryMessageEnum.SelectedChainToDisposeOfNext, ghmshPlayerIDType],
  [GameHistoryMessageEnum.ReceivedBonus, ghmshPlayerIDType],
  [GameHistoryMessageEnum.DisposedOfShares, ghmshPlayerIDType],
  [GameHistoryMessageEnum.CouldNotAffordAnyShares, ghmshPlayerID],
  [GameHistoryMessageEnum.PurchasedShares, ghmshPurchasedShares],
  [GameHistoryMessageEnum.DrewLastTile, ghmshPlayerID],
  [GameHistoryMessageEnum.ReplacedDeadTile, ghmshPlayerIDTile],
  [GameHistoryMessageEnum.EndedGame, ghmshPlayerID],
  [GameHistoryMessageEnum.NoTilesPlayedForEntireRound, ghmsh],
  [GameHistoryMessageEnum.AllTilesPlayed, ghmsh],
]);
function getGameHistoryMessageString(gameHistoryMessage: GameHistoryMessageData) {
  return gameHistoryMessageStringHandlers.get(gameHistoryMessage.gameHistoryMessage)!(gameHistoryMessage);
}

function getNextActionString(action: ActionBase) {
  const nextPlayerID = action.playerID;
  const nextActionName = action.constructor.name.slice(6);

  const parts = [nextPlayerID.toString(), nextActionName];

  if (action instanceof ActionSelectNewChain) {
    parts.push(action.availableChains.map((x: GameBoardType) => GameBoardType[x][0]).join(','));
  } else if (action instanceof ActionSelectMergerSurvivor) {
    parts.push(action.chainsBySize[0].map((x: GameBoardType) => GameBoardType[x][0]).join(','));
  } else if (action instanceof ActionSelectChainToDisposeOfNext) {
    parts.push(action.defunctChains.map((x: GameBoardType) => GameBoardType[x][0]).join(','));
  } else if (action instanceof ActionDisposeOfShares) {
    parts.push(GameBoardType[action.defunctChain][0]);
  }

  return parts.join(' ');
}

function getFormattedGameJSONLines(game: Game) {
  const [
    gameMode,
    playerArrangementMode,
    timeControlStartingAmount,
    timeControlIncrementAmount,
    userIDs,
    usernames,
    hostUserID,
    tileBag,
    gameActions,
  ] = game.toJSON();

  const lines: string[] = [];

  lines.push('[');

  lines.push(`  ${JSON.stringify(gameMode)},`);
  lines.push(`  ${JSON.stringify(playerArrangementMode)},`);
  lines.push(`  ${JSON.stringify(timeControlStartingAmount)},`);
  lines.push(`  ${JSON.stringify(timeControlIncrementAmount)},`);
  lines.push(`  ${JSON.stringify(userIDs)},`);
  lines.push(`  ${JSON.stringify(usernames)},`);
  lines.push(`  ${JSON.stringify(hostUserID)},`);
  lines.push(`  ${JSON.stringify(tileBag)},`);

  lines.push('  [');

  const lastGameActionIndex = gameActions.length - 1;
  for (let i = 0; i < gameActions.length; i++) {
    const gameAction = [...gameActions[i]];
    gameAction[0] = PB_GameAction.create(gameAction[0]);

    const json = JSON.stringify(gameAction).replace('"chains":[],', '');
    const possibleTrailingComma = i !== lastGameActionIndex ? ',' : '';
    lines.push(`    ${json}${possibleTrailingComma}`);
  }

  lines.push('  ]');

  lines.push(']');

  return lines;
}
