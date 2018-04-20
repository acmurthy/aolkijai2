import { GameAction, GameBoardType, GameHistoryMessage } from '../enums';
import { UserInputError } from '../error';
import { Game } from '../game';
import { ActionBase } from './base';

export class ActionSelectNewChain extends ActionBase {
    constructor(game: Game, playerID: number, public availableChains: GameBoardType[], public tile: number) {
        super(game, playerID, GameAction.SelectNewChain);
    }

    prepare() {
        if (this.availableChains.length === 1) {
            this.createNewChain(this.availableChains[0]);
            return [];
        } else {
            this.game.setGameBoardPosition(this.tile, GameBoardType.NothingYet);
            this.game.determineTileRackTypesForEverybody();
            return null;
        }
    }

    execute(parameters: any[]) {
        if (parameters.length !== 1) {
            throw new UserInputError('did not get exactly 1 parameter');
        }
        const chain: number = parameters[0];
        if (!Number.isInteger(chain) || chain < GameBoardType.Luxor || chain > GameBoardType.Imperial) {
            throw new UserInputError('parameter is not a valid chain');
        }
        if (this.availableChains.indexOf(chain) === -1) {
            throw new UserInputError('cannot select chain as the new chain');
        }

        this.createNewChain(chain);
        return [];
    }

    protected createNewChain(chain: GameBoardType) {
        this.game.fillCells(this.tile, chain);
        this.game.setChainSize(chain, this.game.gameBoardTypeCounts[chain]);
        if (this.game.scoreBoardAvailable.get(chain, 0) > 0) {
            this.game.adjustPlayerScoreBoardRow(this.playerID, [[chain, 1]]);
        }

        this.game.getCurrentMoveData().addGameHistoryMessage(GameHistoryMessage.FormedChain, this.playerID, [chain]);
    }
}