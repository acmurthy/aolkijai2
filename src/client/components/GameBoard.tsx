import { List } from 'immutable';
import * as React from 'react';

import { GameBoardType } from '../../enums';
import { GameBoardLabelMode } from '../enums';
import { getCssStyleForGameBoardType, getHotelInitial, getTileString } from '../helpers';
import * as style from './GameBoard.css';

export function GameBoard({
    gameBoard,
    tileRack,
    labelMode,
    cellSize,
}: {
    gameBoard: List<GameBoardType>;
    tileRack: List<number | null>;
    labelMode: GameBoardLabelMode;
    cellSize: number;
}) {
    let myTiles: { [key: number]: boolean } = {};
    for (let tileIndex = 0; tileIndex < 6; tileIndex++) {
        const tile = tileRack.get(tileIndex, 0);
        if (tile !== null) {
            myTiles[tile] = true;
        }
    }

    const rows = new Array(9);
    for (let y = 0; y < 9; y++) {
        const cells = new Array(12);
        for (let x = 0; x < 12; x++) {
            const tile = x * 9 + y;
            const gameBoardType = myTiles[tile] ? GameBoardType.IHaveThis : gameBoard.get(tile, 0);

            let label;
            if (labelMode === GameBoardLabelMode.Coordinates) {
                label = getTileString(tile);
            } else if (labelMode === GameBoardLabelMode.HotelInitials) {
                if (gameBoardType === GameBoardType.Nothing || gameBoardType === GameBoardType.IHaveThis) {
                    label = getTileString(tile);
                } else if (gameBoardType <= GameBoardType.Imperial) {
                    label = getHotelInitial(gameBoardType);
                } else {
                    label = '';
                }
            } else if (labelMode === GameBoardLabelMode.Nothing) {
                if (gameBoardType === GameBoardType.Nothing || gameBoardType === GameBoardType.IHaveThis) {
                    label = getTileString(tile);
                } else {
                    label = '';
                }
            }

            cells[x] = (
                <td key={x} className={getCssStyleForGameBoardType(gameBoardType)}>
                    {label}
                </td>
            );
        }
        rows[y] = <tr key={y}>{cells}</tr>;
    }

    return (
        <table className={style.root} style={{ width: cellSize * 12 + 2, height: cellSize * 9 + 2, fontSize: cellSize * 2 / 5 }}>
            <tbody>{rows}</tbody>
        </table>
    );
}