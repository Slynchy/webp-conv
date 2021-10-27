// webp-conv

// IMPORTS
const fs = require("fs");
const path = require("path");
const {spawn} = require("child_process");
const {platform} = require("os");

// RUNTIME VARIABLES
const args = process.argv.slice(2);
const osType = platform();
const cwebpExt = osType === "win32" ? ".exe" : "";
const cwebpPath = path.resolve("bin/cwebp" + cwebpExt);
let silentMode = false;
let testMode = false;
let inputDirectory = "input/";
let outputDirectory = "output/";

// CONSTANTS
const COMPATIBLE_FILE_EXTS = ["png", "jpg", "jpeg"];
const MAX_CONCURRENT_FILES = 3;
const HELP_TEXT =
`
webp-conv
Usage: node index.js [optional path to input folder] [optional path to output folder] [optional path to cwebp] [flags]
Compatible formats: ${COMPATIBLE_FILE_EXTS.join(", ")}

Flags:
    -h - Show this help prompt and exit
    -s - Execute script silently
    -t - Test mode (i.e. no actual processes are spawned)
    -c [number] - Maximum number of cwebp processes allowed at once (default: ${MAX_CONCURRENT_FILES})
`;
const BASE_WEBP_SETTINGS = [
    "-mt",
    "-q 50",
    "-pass 10",
    "-m 6",
    "-alpha_filter best",
    "-short",
    "-af",
];

async function main() {
    // Setup flags
    if(checkArgsForFlag("-h")) {
        log(HELP_TEXT);
        return;
    }
    silentMode = checkArgsForFlag("-s");
    testMode = checkArgsForFlag("-t");

    // configure input/output directories
    if(
        args.length >= 1 &&
        fs.existsSync(args[0])
    ) {
        inputDirectory = path.resolve(args[0]);
    }
    if(
        args.length >= 2 &&
        fs.existsSync(args[1])
    ) {
        outputDirectory = path.resolve(args[1]);
    }

    log("Platform is %s", osType);

    let inputExists, outputExists, cwebpExists;
    if(
        !(inputExists = fs.existsSync(inputDirectory)) ||
        !(outputExists = fs.existsSync(outputDirectory)) ||
        !(cwebpExists = fs.existsSync(cwebpPath))
    ) {
        if(!inputExists) console.error("Failed to find input directory '%s'!", inputDirectory);
        if(!outputExists) console.error("Failed to find output directory '%s'!", outputDirectory);
        if(!cwebpExists) console.error("Failed to find cwebp at path '%s'!", cwebpPath);
        return;
    }

    // read input directory
    const inputFiles =
        fs.readdirSync(inputDirectory)
            .filter((e) => {
                const eExt = e.toLowerCase().substr(e.lastIndexOf(".") + 1);
                return COMPATIBLE_FILE_EXTS.findIndex((ext) => ext.indexOf(eExt) !== -1) !== -1;
            });
    if(inputFiles.length === 0) {
        console.error("No compatible files found");
    } else {
        log("%i compatible files found.", inputFiles.length);
    }

    // Create Promises for all files and await until completion
    let concurrency = 0;
    return Promise.all(inputFiles.map((e) => {
        return new Promise(async (_resolve) => {
            const resolve = (err) => {
                if(err)
                    log(`Generated ${e}.webp with warnings.\n${err}`);
                else 
                    log(`Generated ${e}.webp`);
                _resolve();
            }

            // Don't process more files than allowed at once
            if(concurrency >= MAX_CONCURRENT_FILES) {
                await waitForTruth(() => concurrency < MAX_CONCURRENT_FILES);
            }

            // if testmode, don't actually transform any files
            if (!testMode) {
                concurrency++;

                // Create cwebp arguments array
                const cwebpArgs = BASE_WEBP_SETTINGS;
                cwebpArgs.push(`-o "${outputDirectory + e + ".webp"}"`);
                cwebpArgs.push(`"${inputDirectory + e}"`);

                log(`Executing cwebp on ${e}...`);
                const proc = spawn(cwebpPath, cwebpArgs, {shell: osType === "win32"});

                // Set the encoding so we don't have to `.toString()` everything
                proc.stdout.setEncoding("utf8");
                proc.stderr.setEncoding("utf8");

                // Set basic logging events
                proc.stdout.on("end", (data) => Boolean(data) ? log(data) : undefined);
                proc.stdout.on("message", (data) => Boolean(data) ? log(data) : undefined);

                // Set events for files finishing
                proc.on("close", (code) => {
                    if(code !== 0) {
                        console.error("Non-zero process exit code %i on file '%s'", code, e);
                    }
                    concurrency--;
                    resolve();
                });
                // Add event to stderr (see `hack_IsErrorAnError()` for why its like this)
                proc.stderr.on("data", (_err) => {
                    const err = _err.toString().trim();
                    // ############### HACK ###############
                    if(!hack_IsErrorAnError()) return;
                    // ############### /HACK ##############
                    console.error("Error on file '%s':\n%s", e, err);
                    concurrency--;
                    resolve(err);
                });
            } else {
                resolve();
            }
        });
    }));
}

/**
 * Hacky function to detect if an stderr from cwebp is actually an error
 * Because cwebp outputs everything to stderr apparently.
 * @param err Stringified buffer output from stderr
 * @returns boolean
 */
function hack_IsErrorAnError(err) {
    const errSplit = typeof err === "string" ? err.split(" ") : [""];
    const errStrToCheck = errSplit[errSplit.length - 1];
    let isADecimal, isValidFloat;
    try {
        isADecimal = (errStrToCheck.indexOf(".") !== -1);
        isValidFloat = !isNaN(parseFloat(errStrToCheck));
        if(isADecimal && isValidFloat)
            return false;
    } catch(err) {
        // ignore this error, print full one below
        return true;
    }
}

function waitAsync(millisecondsToWait) {
    return new Promise((resolve) => {
        setTimeout(() => resolve(), millisecondsToWait);
    });
}

function waitForTruth(func) {
    return new Promise((resolve) => {
        retry();
        function retry() {
            if(func()) resolve();
            else waitAsync().then(() => retry());
        }
    });
}

function log() {
    if(!silentMode) console.log.apply(null, arguments);
}

function checkArgsForFlag(flag) {
    return Boolean(args.find((a) => a.indexOf(flag) === 0));
}

main()
    .then(() => {
        log("Script completed.");
    })
    .catch((err) => {
        console.warn("Script encountered a fatal error.");
        console.error(err);
    });
