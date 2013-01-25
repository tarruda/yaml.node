var testutil = require('../testutil');

testutil.simple('documents', [
  ['a', 'b', 'c'],
  { first: 1, second: 2, nested: {name: 'nest a bit more', args: ['n1',2,3,4.3,true, {name: 'another nesting level'}]} },
  'test',
  3,
  5.2,
  true,
  null
]);
