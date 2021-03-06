import { convertCases } from 'utils/convertCases';
import { filterLatin } from 'utils/filterLatin';
import { getCyrillic } from 'utils/getCyrillic';
import { getLatin } from 'utils/getLatin';
import { latinToGla } from 'utils/latinToGla';
import { latinToIpa } from 'utils/latinToIpa';
import { levenshteinDistance } from 'utils/levenshteinDistance';
import { normalize } from 'utils/normalize';
import { removeBrackets } from 'utils/removeBrackets';
import { removeExclamationMark } from 'utils/removeExclamationMark';
import { srGajevicaToVukovica } from 'utils/srGajevicaToVukovica';

import { conjugationVerbFlat } from 'utils/legacy/conjugationVerb';
import { declensionAdjectiveFlat } from 'utils/legacy/declensionAdjective';
import { declensionNounFlat } from 'utils/legacy/declensionNoun';
import { declensionNumeralFlat } from 'utils/legacy/declensionNumeral';
import { declensionPronounFlat } from 'utils/legacy/declensionPronoun';
import {
    getGender,
    getNumeralType,
    getPartOfSpeech,
    getPronounType,
    isAnimated,
    isIndeclinable,
    isPlural,
    isSingular,
} from 'utils/wordDetails';

export const searchTypes = {
    begin: (item, text) => item.indexOf(text) === 0,
    full: (item, text) => item === text,
    end: (item, text) =>  item.includes(text) && item.indexOf(text) === item.length - text.length,
    some: (item, text) => item.includes(text),
};

export interface ITranslateParams {
    inputText: string;
    from: string;
    to: string;
    searchType: string;
    posFilter: string;
    flavorisationType: string;
}

export const dataDelimiter = '<>';

export const validFields = [
    'isv',
    'addition',
    'partOfSpeech',
    // 'type',
    'en',
    // 'sameInLanguages',
    // 'genesis',
    'ru',
    'be',
    'uk',
    'pl',
    'cs',
    'sk',
    'bg',
    'mk',
    'sr',
    'hr',
    'sl',
    'de',
    'id',
    // 'frequency',
];

const isvReplacebleLetters = [
    ['đ', 'dž'],
    ['ć', 'č'],
    ['ž', 'z'],
    ['š', 's'],
    ['č', 'c'],
    ['ě', 'e'],
    ['y', 'i'],
    ['å', 'a'],
    ['ę', 'e'],
    ['ų', 'u'],
    ['ò', 'o'],
    ['ŕ', 'r'],
    ['ľ', 'l'],
    ['ń', 'n'],
    ['ť', 't'],
    ['ď', 'd'],
    ['ś', 's'],
    ['ź', 'z'],
];

function getWordForms(item) {
    const [word, add, details] = item;
    const pos = getPartOfSpeech(details);
    const wordForms = [];
    word.split(',').map((wordElement) => {
        wordElement = wordElement.trim();
        switch (pos) {
            case 'verb':
                wordForms.push(...conjugationVerbFlat(wordElement, add));
                break;
            case 'adjective':
                wordForms.push(...declensionAdjectiveFlat(wordElement, ''));
                break;
            case 'noun':
                const gender = getGender(details);
                const animated = isAnimated(details);
                const plural = isPlural(details);
                const singular = isSingular(details);
                const indeclinable = isIndeclinable(details);
                if (details.includes('m./f.')) {
                    wordForms.push(...declensionNounFlat(wordElement, add, 'masculine', animated, plural,
                        singular, indeclinable));
                    wordForms.push(...declensionNounFlat(wordElement, add, 'feminine', animated, plural,
                        singular, indeclinable));
                } else {
                    wordForms.push(...declensionNounFlat(wordElement, add, gender, animated, plural,
                        singular, indeclinable));
                }
                break;
            case 'pronoun':
                wordForms.push(...declensionPronounFlat(wordElement, getPronounType(details)));
                break;
            case 'numeral':
                wordForms.push(...declensionNumeralFlat(wordElement, getNumeralType(details)));
                break;
        }
    });
    return Array.from(new Set(wordForms));
}

export interface ITranslateResult {
    translate: string;
    original: string;
    originalCyr: string;
    originalGla: string;
    add: string;
    addCyr: string;
    addGla: string;
    details: string;
    ipa: string;
    checked: boolean;
}

class DictionaryClass {
    public static getInstance(): DictionaryClass {
        if (!DictionaryClass.instance) {
            DictionaryClass.instance = new DictionaryClass();
        }

        return DictionaryClass.instance;
    }

    private static instance: DictionaryClass;

    private header: string[];
    private langsList: string[];
    private headerIndexes: Map<string, number>;
    private percentsOfChecked: {[lang: string]: string};
    private words: string[][];
    private splittedMap: Map<string, string[]>;
    private isvSearchLetters: { from: string[], to: string[] };

    private constructor() {
        this.header = [];
        this.langsList = [];
        this.headerIndexes = new Map();
        this.splittedMap = new Map();
        this.percentsOfChecked = {};
        this.percentsOfChecked = {};
        this.isvSearchLetters =  { from: [], to: [] };
    }

    public init(
        wordList: string[][],
        searchIndex?: any | false,
        percentsOfChecked?: any,
    ) {
        if (process.env.NODE_ENV !== 'production') {
            // tslint:disable-next-line
            console.time('INIT');
        }

        this.header = validFields;
        this.langsList = this.header.filter(
            (item) => (['partOfSpeech', 'type', 'sameInLanguages', 'genesis', 'addition', 'id' ,
                'frequency'].indexOf(item) === -1),
        );
        this.headerIndexes = new Map(this.header.map((item, i: number) => [this.header[i], i]));

        this.words = wordList;
        const searchIndexExist = Boolean(searchIndex);

        if (!searchIndexExist) {
            this.words.forEach((item) => {
                this.langsList.forEach((from) => {
                    const key = `${this.getField(item, 'id')}-${from}`;
                    let fromField = this.getField(item, from);
                    fromField = removeBrackets(fromField, '[', ']');
                    fromField = removeBrackets(fromField, '(', ')');

                    let splittedField;
                    if (from === 'isv') {
                        splittedField = this
                            .splitWords(fromField)
                            .concat(getWordForms(item))
                        ;
                        this.splittedMap.set(key + '-src',
                            splittedField.map((chunk) => this.searchPrepare('isv-src', getLatin(chunk, '2'))));
                    } else {
                        fromField = removeExclamationMark(fromField);
                        splittedField = this.splitWords(fromField);
                    }
                    this.splittedMap.set(key, splittedField.map((chunk) => this.searchPrepare(from, chunk)));
                });
            });
            this.langsList.forEach((fieldName) => {
                const notChecked = this.words.filter((item) => this.getField(item, fieldName)[0] === '!');
                const count = (1 - notChecked.length / this.words.length) * 100;
                this.percentsOfChecked[fieldName] = count.toFixed(1);
            });
        } else {
            this.splittedMap = new Map(searchIndex);
            this.percentsOfChecked = percentsOfChecked;
        }

        if (process.env.NODE_ENV !== 'production') {
            // tslint:disable-next-line
            console.timeEnd('INIT');
        }
    }
    public getWordList(): string[][] {
        return this.words;
    }
    public getIndex() {
        return Array.from(this.splittedMap.keys()).map((key: string) => [
            key,
            this.splittedMap.get(key),
        ]);
    }
    public translate(translateParams: ITranslateParams): string[][] {
        const {
            inputText,
            from,
            to,
            posFilter,
            flavorisationType,
        } = translateParams;
        let searchType = translateParams.searchType;

        const inputOptions = inputText.split(' -').map((option) => option.trim());
        const inputWord = inputOptions.shift();
        const lang = from === 'isv' ? to : from;
        const inputIsvPrepared = this.inputPrepare('isv', inputWord);
        const inputLangPrepared = this.inputPrepare(lang, inputWord);
        if (!inputLangPrepared || !inputIsvPrepared) {
            return [];
        }
        if (process.env.NODE_ENV !== 'production') {
            // tslint:disable-next-line
            console.time('TRANSLATE');
        }
        const isvText = (from === 'isv' ?
            this.applyIsvSearchLetters(getLatin(inputWord, flavorisationType), flavorisationType)
            : '');

        // option -end - search by ending of word
        if (inputOptions.some((option) => option.trim() === 'end')) {
            searchType = 'end';
        }

        // option -etym - hard search by etymological orthography for Isv
        const hardEtymSearch = from === 'isv' && (inputOptions.some((o) => o === 'etym') ||
            (flavorisationType === '2' &&
            isvReplacebleLetters.every((letter) => this.isvSearchLetters.from.includes(letter[0]))));

        // option -b - two-way search
        const twoWaySearch = inputOptions.some((o) => o === 'b');

        // filter by part of speech
        let filterPartOfSpeech = [];
        //   option -p, for example "-p noun.m+v.ipf" - search for masculine nouns or imperfective verbs
        const optionPOS = inputOptions.find((option) => option.slice(0, 2) === 'p ');
        if (optionPOS) {
            filterPartOfSpeech = optionPOS
                .slice(2).replace(/[ \/]/g, '')
                .split('+').filter(Boolean).map((elem) => elem.split('.').filter(Boolean));
        //   filter by interface selector
        } else if (posFilter) {
            filterPartOfSpeech = [[posFilter]];
        }

        const distMap = new WeakMap();
        const results = this.words
            .filter((item) => {
                let filterResult = false;
                if (from === 'isv' || twoWaySearch) {
                    // hard etymological search for isv
                    if (hardEtymSearch) {
                        const splittedField = this.getSplittedField('isv-src', item);
                        if (inputWord.length === 1) {
                            filterResult = searchTypes[searchType](splittedField[0], inputWord);
                        } else {
                            filterResult = splittedField.some((chunk) => searchTypes[searchType](chunk, inputWord));
                        }
                        // for isv only: when entered 1 symbol - searching by first entry of cell
                    } else {
                        const splittedField = this.getSplittedField('isv', item);
                        if (inputIsvPrepared.length === 1) {
                            filterResult = searchTypes[searchType](splittedField[0], inputIsvPrepared);
                        } else {
                            filterResult = splittedField.some((chunk) => searchTypes[searchType](chunk,
                                inputIsvPrepared));
                        }
                    }
                }
                if (to === 'isv' || twoWaySearch) {
                    const splittedField = this.getSplittedField(lang, item);
                    filterResult = filterResult ||
                        splittedField.some((chunk) => searchTypes[searchType](chunk, inputLangPrepared));
                }
                // seach by part of speach
                if (filterResult && filterPartOfSpeech.length) {
                    const partOfSpeech = this.getField(item, 'partOfSpeech')
                        .replace(/[ \/]/g, '').split('.').filter(Boolean);
                    if (partOfSpeech.includes('m') || partOfSpeech.includes('n')
                        || partOfSpeech.includes('f')) {
                        partOfSpeech.push('noun');
                    }
                    if (!filterPartOfSpeech.some((c) => c.every((e) => partOfSpeech.includes(e)))) {
                        return false;
                    }
                }
                return filterResult;
            })
            .filter((item) => {
                let filterResult = true;
                // search in isv with search sensitive letters
                if ((from === 'isv' || twoWaySearch) &&
                   !hardEtymSearch && (flavorisationType === '2' || flavorisationType === '3') &&
                    this.isvSearchLetters.to.some((letter) => inputIsvPrepared.includes(letter))) {
                    const splittedField = this.getSplittedField('isv-src', item);
                    if (isvText.length === 1) {
                        filterResult = searchTypes[searchType](this.applyIsvSearchLetters(splittedField[0],
                            flavorisationType), isvText);
                    } else {
                        filterResult = splittedField.some((chunk) => {
                            return searchTypes[searchType](this.applyIsvSearchLetters(chunk,
                                flavorisationType), isvText);
                        });
                    }
                }
                if (!filterResult && (to === 'isv' || twoWaySearch)) {
                    const splittedField = this.getSplittedField(lang, item);
                    filterResult = filterResult ||
                        splittedField.some((chunk) => searchTypes[searchType](chunk, inputLangPrepared));
                }
                return filterResult;
            })
            .map((item) => {
                let splittedField = this.getSplittedField(from, item);
                if (inputWord.length === 1) {
                    splittedField = splittedField.slice(0, 1);
                }
                if (inputWord.length === 2) {
                    splittedField = splittedField.slice(0, 2);
                }
                let dist = splittedField
                    .reduce((acc, item) => {
                        const lDist = levenshteinDistance(from === 'isv' ? inputIsvPrepared : inputLangPrepared,
                            this.searchPrepare(from, item));
                        if (lDist < acc) {
                            return lDist;
                        }
                        return acc;
                    }, Number.MAX_SAFE_INTEGER);
                if (twoWaySearch) {
                    splittedField = this.getSplittedField(to, item);
                    if (inputWord.length === 1) {
                        splittedField = splittedField.slice(0, 1);
                    }
                    if (inputWord.length === 2) {
                        splittedField = splittedField.slice(0, 2);
                    }
                    const dist2 = splittedField
                        .reduce((acc, item) => {
                            const lDist = levenshteinDistance(from === 'isv' ? inputLangPrepared : inputIsvPrepared,
                                this.searchPrepare(to, item));
                            if (lDist < acc) {
                                return lDist;
                            }
                            return acc;
                        }, Number.MAX_SAFE_INTEGER);
                    dist = dist2 < dist ? dist2 : dist;
                }
                distMap.set(item, dist);
                return item;
            })
            .sort((a, b) => distMap.get(a) - distMap.get(b))
            .slice(0, 50)
        ;
        if (process.env.NODE_ENV !== 'production') {
            // tslint:disable-next-line
            console.timeEnd('TRANSLATE');
        }
        return results;
    }

    public formatTranslate(
        results: string[][],
        from: string,
        to: string,
        flavorisationType: string,
    ): ITranslateResult[] {
        return results.map((item) => {
            const isv = this.getField(item, 'isv');
            const add = this.getField(item, 'addition');
            const translate = this.getField(item, (from === 'isv' ? to : from));
            return {
                translate: removeExclamationMark(translate),
                original: getLatin(isv, flavorisationType),
                originalCyr: getCyrillic(isv, flavorisationType),
                originalGla: latinToGla(getLatin(isv, flavorisationType)),
                add: convertCases(getLatin(add, flavorisationType)),
                addCyr: convertCases(getCyrillic(add, flavorisationType)),
                addGla: convertCases(latinToGla(getLatin(add, flavorisationType))),
                details: this.getField(item, 'partOfSpeech'),
                ipa: latinToIpa(getLatin(removeBrackets(isv, '[', ']'), flavorisationType)),
                checked: translate[0] !== '!',
            };
        });

    }
    public getPercentsOfTranslated() {
        return this.percentsOfChecked;
    }
    public isvToEngLatin(text) {
        return normalize(getLatin(text, '3'))
            .replace(/y/g, 'i');
    }
    public getField(item: string[], fieldName: string) {
        return item[this.headerIndexes.get(fieldName)];
    }
    public changeIsvSearchLetters(letters: string): {from: string[], to: string[]} {
        for (const letter of letters) {
            isvReplacebleLetters
                .filter((replacement) => replacement[0] === letter)
                .map((replacement) => {
                    const index = this.isvSearchLetters.from.indexOf(replacement[0]);
                    if (index !== -1) {
                        this.isvSearchLetters.from.splice(index, 1);
                        this.isvSearchLetters.to.splice(index, 1);
                    } else {
                        this.isvSearchLetters.from.push(replacement[0]);
                        this.isvSearchLetters.to.push(replacement[1]);
                    }
                });
        }
        return this.isvSearchLetters;
    }
    public setIsvSearchLetters(letters: {from: string[], to: string[]}): void {
        this.isvSearchLetters = letters;
    }
    private getSplittedField(from: string, item: string[]): string[] {
        const key = `${this.getField(item, 'id')}-${from}`;
        return this.splittedMap.get(key);
    }
    private splitWords(text: string): string[] {
        return text.includes(';') ? text.split(';') : text.split(',');
    }
    private inputPrepare(lang: string, text: string): string {
        const lowerCaseText = text.toLowerCase()
            .replace(/ /g, '')
            .replace(/,/g, '')
            .replace(/[\u0300-\u036f]/g, '');
        switch (lang) {
            case 'isv-src':
                return lowerCaseText;
            case 'isv':
                return this.isvToEngLatin(lowerCaseText);
            case 'cs':
            case 'pl':
            case 'sk':
            case 'sl':
            case 'hr':
            case 'de':
                return filterLatin(lowerCaseText);
            case 'ru':
                return lowerCaseText.replace(/ё/g, 'е');
            case 'sr':
                return srGajevicaToVukovica(lowerCaseText);
            default:
                return lowerCaseText;
        }
    }
    private searchPrepare(lang: string, text: string): string {
        const lowerCaseText = text.toLowerCase()
            .replace(/ /g, '')
            .replace(/,/g, '')
            .replace(/[\u0300-\u036f]/g, '');
        switch (lang) {
            case 'isv-src':
                return lowerCaseText;
            case 'isv':
                return this.isvToEngLatin(lowerCaseText);
            case 'cs':
            case 'pl':
            case 'sk':
            case 'sl':
            case 'hr':
            case 'de':
                return filterLatin(lowerCaseText);
            case 'ru':
                return lowerCaseText.replace(/ё/g, 'е');
            default:
                return lowerCaseText;
        }
    }
    private applyIsvSearchLetters(text: string, flavorisationType: string): string {
        text = this.searchPrepare('isv-src', text);
        isvReplacebleLetters
            .filter((replacement) =>
                !this.isvSearchLetters.from.includes(replacement[0]) ||
                flavorisationType === '3' && !['š', 'ž', 'č', 'ě', 'y'].includes(replacement[0]))
            .map((replacement) => {
                text = text.replace(new RegExp(replacement[0], 'g'), replacement[1]);
            });
        return text;
    }
}

export const Dictionary = DictionaryClass.getInstance();
