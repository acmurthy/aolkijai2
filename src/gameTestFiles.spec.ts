// this file was generated by running `yarn generateGameTestFilesSpec` and then formatting this file

import { runGameTestFile } from './runGameTestFile';

describe('game test files', () => {
    describe('start game', () => {
        it('initial tile rack types are correct', () => runGameTestFile('start game/initial tile rack types are correct'));
        it('it works', () => runGameTestFile('start game/it works'));
    });
});
