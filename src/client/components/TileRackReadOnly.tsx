import { List } from 'immutable';
import * as React from 'react';

import { GameBoardType } from '../../common/enums';
import * as commonStyle from '../common.css';
import { gameBoardTypeToCSSClassName, getTileString } from '../helpers';
import * as style from './TileRackReadOnly.css';

export interface TileRackReadOnlyProps {
    tiles: List<number | null>;
    types: List<GameBoardType | null>;
    buttonSize: number;
}

export class TileRackReadOnly extends React.PureComponent<TileRackReadOnlyProps> {
    render() {
        const { tiles, types, buttonSize } = this.props;

        const buttonStyle = {
            width: buttonSize,
            minWidth: buttonSize,
            height: buttonSize,
            minHeight: buttonSize,
        };

        return (
            <div className={style.root} style={{ fontSize: Math.floor(buttonSize * 0.4) }}>
                {tiles.map((tile, i) => {
                    const type = types.get(i, 0);

                    if (tile !== null && type !== null) {
                        const disabled = type === GameBoardType.CantPlayEver || type === GameBoardType.CantPlayNow;
                        return (
                            <div key={i} className={style.button + ' ' + gameBoardTypeToCSSClassName[type]} style={buttonStyle}>
                                <div>{getTileString(tile)}</div>
                            </div>
                        );
                    } else {
                        return (
                            <div key={i} className={style.button + ' ' + commonStyle.invisible} style={buttonStyle}>
                                ?
                            </div>
                        );
                    }
                })}
            </div>
        );
    }
}