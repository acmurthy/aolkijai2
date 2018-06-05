import { List } from 'immutable';
import { GameMode, GameSetupChange, PlayerArrangementMode } from './enums';
import { gameModeToNumPlayers, gameModeToTeamSize, shuffleArray } from './helpers';

const defaultApprovals = new Map<number, List<boolean>>([
    [1, List<boolean>([false])],
    [2, List<boolean>([false, false])],
    [3, List<boolean>([false, false, false])],
    [4, List<boolean>([false, false, false, false])],
    [5, List<boolean>([false, false, false, false, false])],
    [6, List<boolean>([false, false, false, false, false, false])],
]);

type GameSetupJSON = [GameMode, PlayerArrangementMode, number, number[], number[]];

export class GameSetup {
    hostUsername: string;
    usernames: List<string | null>;
    approvals: List<boolean>;
    approvedByEverybody: boolean;
    usernameToUserID: Map<string, number>;
    userIDToUsername: Map<number, string>;
    history: any[] = [];

    constructor(
        public gameMode: GameMode,
        public playerArrangementMode: PlayerArrangementMode,
        public hostUserID: number,
        public getUsernameForUserID: (userID: number) => string,
    ) {
        const numPlayers = gameModeToNumPlayers.get(gameMode)!;
        this.hostUsername = getUsernameForUserID(hostUserID);

        const usernames: (string | null)[] = new Array(numPlayers);
        for (let i = 0; i < numPlayers; i++) {
            usernames[i] = null;
        }
        usernames[0] = this.hostUsername;
        this.usernames = List(usernames);

        this.approvals = defaultApprovals.get(numPlayers)!;

        this.approvedByEverybody = false;

        this.usernameToUserID = new Map([[this.hostUsername, hostUserID]]);

        this.userIDToUsername = new Map([[hostUserID, this.hostUsername]]);
    }

    addUser(userID: number) {
        if (this.usernameToUserID.size === this.usernames.size) {
            return;
        }

        const username = this.getUsernameForUserID(userID);

        if (this.usernameToUserID.has(username)) {
            return;
        }

        for (let i = 0; i < this.usernames.size; i++) {
            if (this.usernames.get(i, null) === null) {
                this.usernames = this.usernames.set(i, username);
                this.approvals = defaultApprovals.get(gameModeToNumPlayers.get(this.gameMode)!)!;
                this.approvedByEverybody = false;
                this.usernameToUserID.set(username, userID);
                this.userIDToUsername.set(userID, username);
                this.history.push([GameSetupChange.UserAdded, userID]);
                break;
            }
        }
    }

    removeUser(userID: number) {
        if (!this.userIDToUsername.has(userID)) {
            return;
        }

        const username = this.userIDToUsername.get(userID);

        if (username === this.hostUsername) {
            return;
        }

        for (let i = 0; i < this.usernames.size; i++) {
            if (this.usernames.get(i, null) === username) {
                this.usernames = this.usernames.set(i, null);
                this.approvals = defaultApprovals.get(gameModeToNumPlayers.get(this.gameMode)!)!;
                this.approvedByEverybody = false;
                this.usernameToUserID.delete(username);
                this.userIDToUsername.delete(userID);
                this.history.push([GameSetupChange.UserRemoved, userID]);
                break;
            }
        }
    }

    approve(userID: number) {
        if (!this.userIDToUsername.has(userID)) {
            return;
        }

        if (this.usernameToUserID.size !== this.usernames.size) {
            return;
        }

        const username = this.userIDToUsername.get(userID);

        for (let i = 0; i < this.usernames.size; i++) {
            if (this.usernames.get(i, null) === username) {
                if (this.approvals.get(i, false) === false) {
                    this.approvals = this.approvals.set(i, true);
                    this.history.push([GameSetupChange.UserApprovedOfGameSetup, userID]);
                }
                break;
            }
        }

        this.approvedByEverybody = this.approvals.indexOf(false) === -1;
    }

    changeGameMode(gameMode: GameMode) {
        if (gameMode === this.gameMode) {
            return;
        }

        const newNumPlayers = gameModeToNumPlayers.get(gameMode) || 0;
        if (this.usernameToUserID.size > newNumPlayers) {
            return;
        }

        const oldNumPlayers = gameModeToNumPlayers.get(this.gameMode)!;

        if (newNumPlayers !== oldNumPlayers) {
            const usernames = this.usernames.toJS();

            if (newNumPlayers > oldNumPlayers) {
                const numSpotsToAdd = newNumPlayers - oldNumPlayers;
                for (let i = 0; i < numSpotsToAdd; i++) {
                    usernames.push(null);
                }
            } else {
                for (let oldIndex = oldNumPlayers - 1; oldIndex >= newNumPlayers; oldIndex--) {
                    if (usernames[oldIndex] !== null) {
                        for (let newIndex = newNumPlayers - 1; newIndex >= 0; newIndex--) {
                            if (usernames[newIndex] === null) {
                                usernames[newIndex] = usernames[oldIndex];
                                break;
                            }
                        }
                    }

                    usernames.pop();
                }
            }

            this.usernames = List(usernames);
        }

        this.approvals = defaultApprovals.get(newNumPlayers)!;
        this.approvedByEverybody = false;

        const isTeamGame = gameModeToTeamSize.get(gameMode)! > 1;
        if (!isTeamGame && this.playerArrangementMode === PlayerArrangementMode.SpecifyTeams) {
            this.playerArrangementMode = PlayerArrangementMode.RandomOrder;
        }

        this.gameMode = gameMode;
        this.history.push([GameSetupChange.GameModeChanged, gameMode]);
    }

    changePlayerArrangementMode(playerArrangementMode: PlayerArrangementMode) {
        if (
            playerArrangementMode !== PlayerArrangementMode.RandomOrder &&
            playerArrangementMode !== PlayerArrangementMode.ExactOrder &&
            playerArrangementMode !== PlayerArrangementMode.SpecifyTeams
        ) {
            return;
        }

        if (playerArrangementMode === this.playerArrangementMode) {
            return;
        }

        const isTeamGame = gameModeToTeamSize.get(this.gameMode)! > 1;
        if (!isTeamGame && playerArrangementMode === PlayerArrangementMode.SpecifyTeams) {
            return;
        }

        this.playerArrangementMode = playerArrangementMode;
        this.approvals = defaultApprovals.get(gameModeToNumPlayers.get(this.gameMode)!)!;
        this.approvedByEverybody = false;
        this.history.push([GameSetupChange.PlayerArrangementModeChanged, playerArrangementMode]);
    }

    swapPositions(position1: number, position2: number) {
        if (!Number.isInteger(position1) || position1 < 0 || position1 >= this.usernames.size) {
            return;
        }

        if (!Number.isInteger(position2) || position2 < 0 || position2 >= this.usernames.size) {
            return;
        }

        if (position1 === position2) {
            return;
        }

        const usernames = this.usernames.asMutable();
        usernames.set(position1, this.usernames.get(position2, null));
        usernames.set(position2, this.usernames.get(position1, null));
        this.usernames = usernames.asImmutable();

        this.approvals = defaultApprovals.get(gameModeToNumPlayers.get(this.gameMode)!)!;
        this.approvedByEverybody = false;

        this.history.push([GameSetupChange.PositionsSwapped, position1, position2]);
    }

    kickUser(position: number) {
        if (!Number.isInteger(position) || position < 0 || position >= this.usernames.size) {
            return;
        }

        const username = this.usernames.get(position, null);
        if (username === null) {
            return;
        }

        if (username === this.hostUsername) {
            return;
        }

        const userID = this.usernameToUserID.get(username) || 0;

        this.usernames = this.usernames.set(position, null);
        this.approvals = defaultApprovals.get(gameModeToNumPlayers.get(this.gameMode)!)!;
        this.approvedByEverybody = false;
        this.usernameToUserID.delete(username);
        this.userIDToUsername.delete(userID);
        this.history.push([GameSetupChange.UserKicked, position]);
    }

    clearHistory() {
        this.history = [];
    }

    getFinalUserIDsAndUsernames(): [List<number>, List<string>] {
        const usernames: string[] = this.usernames.toJS();

        if (this.playerArrangementMode === PlayerArrangementMode.RandomOrder) {
            shuffleArray(usernames);
        } else if (this.playerArrangementMode === PlayerArrangementMode.SpecifyTeams) {
            let teams: string[][];
            if (this.gameMode === GameMode.Teams2vs2) {
                teams = [[usernames[0], usernames[2]], [usernames[1], usernames[3]]];
            } else if (this.gameMode === GameMode.Teams2vs2vs2) {
                teams = [[usernames[0], usernames[3]], [usernames[1], usernames[4]], [usernames[2], usernames[5]]];
            } else {
                teams = [[usernames[0], usernames[2], usernames[4]], [usernames[1], usernames[3], usernames[5]]];
            }

            shuffleArray(teams);
            for (let i = 0; i < teams.length; i++) {
                shuffleArray(teams[i]);
            }

            const numPlayersPerTeam = teams[0].length;
            const numTeams = teams.length;
            let nextPlayerID = 0;

            for (let playerIndexInTeam = 0; playerIndexInTeam < numPlayersPerTeam; playerIndexInTeam++) {
                for (let teamIndex = 0; teamIndex < numTeams; teamIndex++) {
                    usernames[nextPlayerID++] = teams[teamIndex][playerIndexInTeam];
                }
            }
        }

        const userIDs: number[] = new Array(usernames.length);
        for (let i = 0; i < usernames.length; i++) {
            const username = usernames[i];
            userIDs[i] = this.usernameToUserID.get(username) || 0;
        }

        return [List(userIDs), List(usernames)];
    }

    toJSON(): GameSetupJSON {
        const userIDs: number[] = new Array(this.usernames.size);
        this.usernames.forEach((username, position) => {
            userIDs[position] = username !== null ? this.usernameToUserID.get(username) || 0 : 0;
        });

        const approvals: number[] = new Array(this.approvals.size);
        this.approvals.forEach((approved, position) => {
            approvals[position] = approved ? 1 : 0;
        });

        return [this.gameMode, this.playerArrangementMode, this.hostUserID, userIDs, approvals];
    }

    static fromJSON(json: GameSetupJSON, getUsernameForUserID: (userID: number) => string) {
        const [gameMode, playerArrangementMode, hostUserID, userIDs, intApprovals] = json;

        const gameSetup = new GameSetup(gameMode, playerArrangementMode, hostUserID, getUsernameForUserID);

        const usernames: (string | null)[] = new Array(userIDs.length);
        for (let position = 0; position < userIDs.length; position++) {
            const userID = userIDs[position];

            if (userID !== 0) {
                const username = getUsernameForUserID(userID);

                usernames[position] = username;

                if (userID !== hostUserID) {
                    gameSetup.usernameToUserID.set(username, userID);
                    gameSetup.userIDToUsername.set(userID, username);
                }
            } else {
                usernames[position] = null;
            }
        }

        gameSetup.usernames = List(usernames);

        const approvals: boolean[] = new Array(intApprovals.length);
        let approvedByEverybody = true;
        for (let position = 0; position < intApprovals.length; position++) {
            const approved = intApprovals[position] === 1;

            approvals[position] = approved;

            if (!approved) {
                approvedByEverybody = false;
            }
        }

        gameSetup.approvals = List<boolean>(approvals);
        gameSetup.approvedByEverybody = approvedByEverybody;

        return gameSetup;
    }
}
