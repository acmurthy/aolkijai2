import { List } from 'immutable';
import * as React from 'react';
import { gameModeToNumPlayers, gameModeToTeamSize } from '../../common/helpers';
import { PB_GameBoardType, PB_GameMode, PB_GameStatus } from '../../common/pb';
import { gameModeToString, gameStatusToString, teamNumberToCSSClassName } from '../helpers';
import * as style from './GameListing.scss';
import { MiniGameBoard } from './MiniGameBoard';

export interface GameListingProps {
  gameBoard: List<List<PB_GameBoardType>>;
  usernames: List<string | null>;
  gameDisplayNumber: number;
  gameMode: PB_GameMode;
  gameStatus: PB_GameStatus;
  onEnterClicked: () => void;
}

export class GameListing extends React.PureComponent<GameListingProps> {
  render() {
    const { gameBoard, usernames, gameDisplayNumber, gameMode, gameStatus, onEnterClicked } = this.props;

    const isTeamGame = gameModeToTeamSize.get(gameMode)! > 1;
    const numTeams = gameModeToNumPlayers.get(gameMode)! / gameModeToTeamSize.get(gameMode)!;

    return (
      <div>
        <div className={style.miniGameBoardWrapper}>
          <MiniGameBoard gameBoard={gameBoard} cellSize={15} />
        </div>
        <table className={style.players}>
          <tbody>
            {usernames.map((username, i) => (
              <tr key={i}>
                <td className={isTeamGame ? teamNumberToCSSClassName.get((i % numTeams) + 1) : style.player}>{username}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className={style.other}>
          <div>Game #{gameDisplayNumber}</div>
          <div>{gameModeToString.get(gameMode)}</div>
          <div>{gameStatusToString.get(gameStatus)}</div>
          <div>
            <input type={'button'} value={'Enter'} onClick={onEnterClicked} />
          </div>
        </div>
      </div>
    );
  }
}
