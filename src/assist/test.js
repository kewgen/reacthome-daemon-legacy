const { closest } = require("./levenshtein")

const subjects = [
    "л",
    "лампа",
    "лампус",
    "лампусик",
    "лампусикус",
    "красная лампа",
    "зеленая лампа",
    "синяя лампа",
]


const tests = [
    "л",
    "лампа",
    "лампус красный",
    "красный",
    "красный лампусик",
    "красный лампусикус",
    "лампа зеленая",
    "лампу",
]

const compare = (words, tests) => {
    let a = 0;
    let h = 1;
    for (const test of tests) {
        const x = closest(test, words)
        a += x
        h += 1 / x
    }
    return (a / tests.length + tests.length / h) / 2
}

for (const test of tests) {
    for (const subject of subjects) {
        console.log(
            test,
            "<->",
            subject,
            "=",
            compare(test.split(" "), subject.split(" ")),
            compare(subject.split(" "), test.split(" ")),
        )
        console.log()
    }
}
