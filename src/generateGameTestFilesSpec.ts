import * as fs from 'fs';
import * as path from 'path';

const inputBasePath: string = `${__dirname}/gameTestFiles/`;

function main() {
    let lines: string[] = [];

    lines.push('// this file was generated by running `yarn generateGameTestFilesSpec` and then formatting this file');
    lines.push('');
    lines.push("import { runGameTestFile } from './runGameTestFile';");
    lines.push('');

    processDirectory(__dirname, 'gameTestFiles', lines);

    fs.writeFileSync(`${__dirname}/gameTestFiles.spec.ts`, lines.join('\n'));
}

function processDirectory(base: string, dir: string, lines: string[]) {
    lines.push(`describe(${JSON.stringify(base === __dirname ? 'game test files' : dir)}, () => {`);

    const dirPath = path.join(base, dir);
    const files = fs.readdirSync(dirPath);

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const filePath = path.join(dirPath, file);
        const stats = fs.statSync(filePath);
        if (stats.isDirectory()) {
            processDirectory(dirPath, file, lines);
        } else if (stats.isFile()) {
            const relativeFilePath = filePath.slice(inputBasePath.length);
            lines.push(`it(${JSON.stringify(file)}, () => runGameTestFile(${JSON.stringify(relativeFilePath)}));`);
        }
    }

    lines.push('});');
}

main();