import * as React from 'react';
import { GameMode } from '../../common/enums';
import { allGameModes, gameModeToString } from '../helpers';

export interface CreateGameProps {
    gameMode?: GameMode;
    onSubmit: (gameMode: GameMode) => void;
}

interface CreateGameState {
    props: CreateGameProps;
    gameMode: GameMode;
}

export class CreateGame extends React.PureComponent<CreateGameProps, CreateGameState> {
    constructor(props: CreateGameProps) {
        super(props);

        this.state = CreateGame._getDerivedStateFromProps(props);
    }

    static _getDerivedStateFromProps(props: CreateGameProps): CreateGameState {
        return {
            props,
            gameMode: props.gameMode !== undefined ? props.gameMode : GameMode.Singles4,
        };
    }

    static getDerivedStateFromProps(nextProps: CreateGameProps, prevState: CreateGameState) {
        if (nextProps.gameMode !== prevState.props.gameMode) {
            return CreateGame._getDerivedStateFromProps(nextProps);
        } else if (nextProps.onSubmit !== prevState.props.onSubmit) {
            return { ...prevState, props: nextProps };
        } else {
            return null;
        }
    }

    render() {
        const { gameMode } = this.state;

        return (
            <div>
                Mode:{' '}
                <select value={gameMode.toString()} onChange={this.onChangeGameMode}>
                    {allGameModes.map(gm => (
                        <option key={gm} value={gm}>
                            {gameModeToString.get(gm)}
                        </option>
                    ))}
                </select>{' '}
                <input type={'button'} value={'Create Game'} onClick={this.onSubmit} />
            </div>
        );
    }

    onChangeGameMode = (event: React.FormEvent<HTMLSelectElement>) => {
        this.setState({
            gameMode: parseInt(event.currentTarget.value, 10),
        });
    };

    onSubmit = () => {
        this.props.onSubmit(this.state.gameMode);
    };
}
