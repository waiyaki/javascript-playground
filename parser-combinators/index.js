function failure(expected, actual) {
  return { isFailure: true, expected, actual };
}

function success(data, rest) {
  return { data, rest };
}

function parse(parser, input) {
  const result = parser(input);

  if (result.isFailure) {
    throw new Error(`Parse error.
    Expected ${result.expected}.
    Instead found ${result.actual}`);
  }

  return result;
}

function text(match) {
  return function textParser(input) {
    if (input.startsWith(match)) {
      return success(match, input.slice(match.length));
    }

    return failure(`'${match}'`, input);
  };
}

function regex(re) {
  const anchoredRegex = new RegExp(`^${re.source}`);

  return function regexParser(input) {
    const match = anchoredRegex.exec(input);

    if (match !== null) {
      const [matchedText] = match;

      return success(matchedText, input.slice(matchedText.length));
    }

    return failure(re, input);
  };
}

function eof(input) {
  return input.length === 0
    ? success(null, input)
    : failure('end of input', input);
}

/**
 * Helper function which transforms the result of any parser.
 *
 * @param {Function} func Transforming function
 * @param {Function} parser Parser function
 */
function map(func, parser) {
  return function mapParser(input) {
    const result = parser(input);

    if (result.isFailure) {
      return result;
    }

    return success(func(result.data), result.rest);
  };
}

/**
 * Run input through a set of parsers and return the first
 * successful result.
 * Return failure if none of the parsers succeeds.
 *
 * @param  {...Function} parsers Parsing functions
 * @returns {Object} Parsing result or failure
 */
function oneOf(...parsers) {
  return function oneOfParser(input) {
    for (const parser of parsers) {
      const result = parser(input);
      if (!result.isFailure) {
        return result;
      }
    }

    return failure('oneOf', input);
  };
}

/**
 * Sequencing combinator that applies a function to the results of
 * applying some input to the provided parsers.
 * Takes care of error handling state passing (passing the rest of
 * the input between steps).
 *
 * @param {Function} func Function to apply to the collected results from all parsers
 * @param {Function[]} parsers Array of parsers to be sequenced
 * @returns {Function} applyParser
 */
function apply(func, parsers) {
  return function applyParser(input) {
    const accData = [];
    let currentInput = input;

    for (const parser of parsers) {
      const result = parser(currentInput);
      if (result.isFailure) {
        return result;
      }

      accData.push(result.data);
      currentInput = result.rest;
    }

    return success(func(...accData), currentInput);
  };
}

/**
 * Return the results of parsing as an array.
 *
 * @param  {...Function} parsers Parsing functions
 * @returns {*[]} Parsing results
 */
function collect(...parsers) {
  return apply(Array.of, parsers);
}

/**
 * Decorate a parser with a user friendly message when parsing fails.
 *
 * @param {Function} parser Parser function
 * @param {*} expected User friendly label for the expected input.
 * @returns {Object} Parsed result or failure.
 */
function label(parser, expected) {
  return function labelParser(input) {
    const result = parser(input);

    if (result.isFailure) {
      return failure(expected, result.actual);
    }

    return result;
  };
}

/**
 * Take a parser for "junk" (e.g whitespaces, comments) and return
 * another function which takes a parser for some meaningful data. This
 * returned parser in turn returns a parser that parses the meaningful data then
 * skips the junk.
 *
 * @param {Function} junk Junk parser
 * @returns {Function}
 */
function lexeme(junk) {
  return function createTokenParser(parser) {
    return apply(
      // `apply` runs the input through both (meaningful data) `parser` and the
      // `junk` parser, then its transforming function skips over the result of
      // the `junk` parser and only returns the data from `parser`.
      (data, _) => data, // eslint-disable-line no-unused-vars
      [parser, junk],
    );
  };
}

const opMap = {
  '+': (left, right) => left + right,
  '-': (left, right) => left - right,
  '*': (left, right) => left * right,
  '/': (left, right) => left / right,
};

function getOp(op) {
  return opMap[op];
}

const op = map(
  getOp,
  label(
    oneOf(text('+'), text('-'), text('*'), text('/')),
    'an arithmetic operator',
  ),
);

const decimal = map(Number, label(regex(/\d+(?:\.\d+)?/), 'a decimal'));

const spaces = regex(/\s*/);
const token = lexeme(spaces);

const expr = apply((_, n1, opFunc, n2) => opFunc(n1, n2), [
  spaces, // skip any leading spaces
  token(decimal),
  token(label(op, 'an arithmetic operator')),
  token(decimal), // skips any trailing spaces.
  eof,
]);

console.log(parse(expr, '23 + 23'));
// => { data: 46, rest: '' }

/**
 * Like `apply`, a sequencing parser combinator that unlike `apply`,
 * which steps over an array of parsers, steps over a generator object.
 *
 * @param {Function} genFunc Generator function
 * @returns {Function} Yielding parser that steps the input over yielded
 *                     parsers.
 */
function go(genFunc) {
  return function yieldParser(input) {
    const gen = genFunc();
    let currentInput = input;
    let genResult = gen.next();

    // if not done yet, genResult.value is the next parser
    while (!genResult.done) {
      const result = genResult.value(currentInput);

      if (result.isFailure) {
        return result;
      }

      currentInput = result.rest;
      genResult = gen.next(result.data);
    }

    // If done, genResult.value is the return value of the parser
    return success(genResult.value, currentInput);
  };
}

const exprGen = go(function* exprGen() {
  yield spaces;
  const num1 = yield token(decimal);
  const opFunc = yield token(op);
  const num2 = yield token(decimal);
  yield eof;

  return opFunc(num1, num2);
});

console.log(parse(exprGen, '23 + 23'));
// => { data: 46, rest: '' }

function pure(value) {
  return function pureParser(input) {
    return success(value, input);
  };
}

/**
 * Create a parser function that will parse some token as many times as
 * possible.
 *
 * @param {Function} parser Parser function
 */
function many(parser) {
  const self = oneOf(
    go(function* manyParserGen() {
      const head = yield parser;

      // 1. keep calling self recusively
      const tail = yield self;
      return [head, ...tail];
    }),

    // 2. Wait until it fails, return an empty array
    pure([]),
  );

  return self;
}

console.log(parse(many(regex(/\d/)), '123xyd'));
// => { data: [ '1', '2', '3' ], rest: 'xyd' }

const arbitraryLengthExpr = go(function* arbitraryLengthExpr() {
  yield spaces;
  const num1 = yield token(decimal);
  const rest = yield many(collect(token(op), token(decimal)));
  yield eof;
  return rest.reduce((acc, [opFunc, num]) => opFunc(acc, num), num1);
});

console.log(parse(arbitraryLengthExpr, '1 + 2 + 3 + 5'));
// => { data: 11, rest: ''}
