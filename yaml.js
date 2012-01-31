// YAML.node, © 2011 Stéphan Kochen
// MIT-licensed. (See the included LICENSE file.)

var fs = require('fs'),
    util = require('util'),
    events = require('events'),
    binding = require('./build/Release/binding');


// Low-level YAML stream exports.
exports.stream = {};

// Create a raw event stream from YAML input.
//
//     var output = yaml.stream.parse(input, handler);
//
// The handler can be an object that exposes methods for each LibYAML parser event. These are
// named `onScalar`, `onSequenceStart`, etc. All of these methods take an event object that is
// similar in structure to a flattened `yaml_event_t`.
//
// Alternatively, a single function can be passed in to handle all events.
exports.stream.parse = function(input, handler) {
  if (typeof(handler) !== 'function') {
    var orig = handler;
    handler = function(event) {
      var type = event.type;
      var method = 'on' + type.charAt(0).toUpperCase() + type.slice(1);
      if (typeof(orig[method]) === 'function')
        orig[method](event);
    };
  }

  binding.parse(input, handler);
};

// Create a YAML data stream from raw events.
//
//     var emitter = yaml.stream.createEmitter(function(data) { /* ... */ });
//     emitter.stream(function() {
//       emitter.document(function() {
//         emitter.scalar("foobar");
//       });
//     });
//
// YAML stream events are exposed as methods on the emitter, e.g. 'streamStart', 'scalar', etc.
// Additionally, events that come in start/end pairs are exposed as single methods taking a
// function to wrap with the start and end events.
//
// As libYAML produces output, `data` events are emitted. The `createEmitter` factory can take
// a function argument which is immediately installed as a `data` event listener.
var YamlStreamEmitter = function() {
  var callback = this.emit.bind(this, 'data');
  this.emitter_ = new binding.Emitter(callback);
};
util.inherits(YamlStreamEmitter, events.EventEmitter);

YamlStreamEmitter.prototype.event = function(obj) {
  if (typeof(obj) === 'string')
    obj = { type: obj };
  this.emitter_.event(obj);
};

['stream', 'document', 'sequence', 'mapping'].forEach(function(pre) {
  var startEvent = pre + 'Start';
  YamlStreamEmitter.prototype[startEvent] = function() {
    this.emitter_.event({ type: startEvent });
  };

  var endEvent = pre + 'End';
  YamlStreamEmitter.prototype[endEvent] = function() {
    this.emitter_.event({ type: endEvent });
  };

  YamlStreamEmitter.prototype[pre] = function(block) {
    this.emitter_.event({ type: startEvent });
    var result = block();
    this.emitter_.event({ type: endEvent });
    return result;
  };
});

YamlStreamEmitter.prototype.alias = function(anchor) {
  this.emitter_.event({ type: 'alias', anchor: anchor });
};

YamlStreamEmitter.prototype.scalar = function(value) {
  this.emitter_.event({ type: 'scalar', value: value });
};

exports.stream.createEmitter = function(handler) {
  var result = new YamlStreamEmitter();
  if (handler) result.on('data', handler);
  return result;
};


// Most of these were derived from: http://yaml.org/type/
// Also borrows from tenderlove's `Psych::ScalarScanner`. (MIT-licensed)
var definitelyNonNumericRe = /^[a-z~]/i,
    definitelyNonBooleanRe = /^[^ytonf~]/i,
    canParseIntRe   = /^[-+]?(0x[0-9a-fA-F_]+|[\d_]+)$/,
    canParseFloatRe = /^[-+]?(\d[\d_]*)?\.[\d_]*(e[-+]\d+)?$/i,
    nullRe   = /^(~|null)$/i,
    trueRe   = /^(y|yes|true|on)$/i,
    falseRe  = /^(n|no|false|off)$/i,
    posInfRe = /^\+?\.inf$/i,
    negInfRe = /^-\.inf$/i,
    nanRe    = /^\.nan$/i,
    binRe    = /^([-+])?0b([01_]+)$/,
    timeRe   = /^([-+]?)([0-9][\d_]*(?::[0-5]?\d)+(?:\.[\d_]*)?)$/,
    dateRe   = /^\d{4}-\d\d?-\d\d?$/,
    timestampRe = /^(\d{4}-\d\d?-\d\d?(?:[Tt]|\s+)\d\d?:\d\d:\d\d(?:\.\d*)?)(?:\s*(Z|[-+]\d\d?(?::\d\d)?))?$/,
    underscoresRe = /_/g;

// Tiny helper to pad a string.
var pad = function(s, num, ch) {
  while (s.length < num) s = ch + s;
  return s;
};

// Helper function that converts a string scalar to its actual type.
var parseScalar = function(v) {
  if (!v) return null;

  // Simple keywords.
  if (definitelyNonNumericRe.test(v)) {
    if (v.length > 5 || definitelyNonBooleanRe.test(v)) return v;
    if (nullRe.test(v)) return null;
    if (trueRe.test(v)) return true;
    if (falseRe.test(v)) return false;
    return v;
  }
  if (posInfRe.test(v)) return  1/0;
  if (negInfRe.test(v)) return -1/0;
  if (nanRe.test(v))    return  0/0;

  // JavaScript's `parseInt` does not support binary numbers.
  var m = binRe.exec(v);
  if (m) {
    var s = m[2],
        length = s.length,
        result = 0;
    for (var i = 0; i < length; i++) {
      if (s[i] == '_')
        continue;
      result *= 2;
      if (s[i] == '1')
        result++;
    }
    if (m[1] == '-')
      result *= -1;
    return result;
  }

  // JavaScript's datetime parsing is subtly different from YAML's.
  var m = timestampRe.exec(v);
  if (m) {
    var dateTimePart = m[1].replace('t', 'T'),
        offset = 0;
    if (m[2] && m[2] !== 'Z') {
      var parts = m[2].split(':');
      offset = parseInt(parts[0], 10) * 100;
      if (parts.length == 2)
        offset += parseInt(parts[1], 10);
    }
    if (offset >= 0)
      offset = "+" + pad(String(offset), 4, '0');
    else
      offset = "-" + pad(String(Math.abs(offset)), 4, '0');
    return new Date(dateTimePart + offset);
  }
  if (dateRe.test(v))
    return new Date(v + "T00:00:00Z");

  // Regular numbers.
  if (canParseIntRe.test(v))
    return parseInt(v.replace(underscoresRe, ''), 0);
  if (canParseFloatRe.test(v))
    return parseFloat(v.replace(underscoresRe, ''));

  // Times.
  var m = timeRe.exec(v);
  if (m) {
    var parts = m[2].split(':'),
        length = parts.length,
        result = 0;
    for (var i = 0; i < length; i++) {
      result *= 60;
      if (length == i + 1)
        result += parseFloat(parts[i]);
      else
        result += parseInt(parts[i], 10);
    }
    if (m[1] == '-')
      result *= -1;
    return result;
  }

  return v;
};


// The `load` function reads all documents from the given string input. The return value is an
// array of documents found represented as plain JavaScript objects, arrays and primitives.
exports.load = function(input, tagHandlers) {
  if (typeof tagHandlers !== 'object')
    tagHandlers = {};

  var parserHandler, handlerStack = [];

  // Capture all values between two parser events. Because we can nest in YAML, we need a stack of
  // these value handlers, and we need to ensure we can deal with `until` blocks that are nested
  // for the same kinds of events (ie. restore the old event handler afterwards).
  var until = function(method, valueHandler) {
    var oldMethod = parserHandler[method];
    handlerStack.unshift(valueHandler);
    parserHandler[method] = function(e) {
      parserHandler[method] = oldMethod;
      var oldHandler = handlerStack.shift();
      oldHandler.after();
    };
  };

  // Dispatch a value. At this point, the value is a JavaScript primitive, ie. sequences are
  // `Array`s, numeric scalars are `Number`s, etc. If a tag was specified, the tag handler
  // function is asked to post process the value. The value is then sent to the current value
  // handler in the stack.
  var dispatch = function(e, value) {
    if (e.tag !== null) {
      var tagHandler = tagHandlers[e.tag];
      // FIXME: Deal with standard tags
      if (tagHandler)
        value = tagHandler(value);
    }
    handlerStack[0].handle(value);
  };

  // Call into the parser and build the documents.
  var documents = [];
  exports.stream.parse(input, parserHandler = {
    onDocumentEnd: null,
    onDocumentStart: function(e) {
      var document;
      until('onDocumentEnd', {
        handle: function(value) {
          document = value;
        },
        after: function() {
          documents.push(document);
        }
      });
    },

    onAlias: function(e) {
      // FIXME
    },

    onScalar: function(e) {
      dispatch(e, parseScalar(e.value));
    },

    onSequenceEnd: null,
    onSequenceStart: function(e) {
      var sequence = [];
      until('onSequenceEnd', {
        handle: function(value) {
          sequence.push(value);
        },
        after: function() {
          dispatch(e, sequence);
        }
      });
    },

    onMappingEnd: null,
    onMappingStart: function(e) {
      var mapping = {}, key = undefined;
      until('onMappingEnd', {
        handle: function(value) {
          if (key === undefined) {
            key = value;
          }
          else {
            mapping[key] = value;
            key = undefined;
          }
        },
        after: function() {
          dispatch(e, mapping);
        }
      });
    }
  });

  return documents;
};

// Helper for quickly reading in a file.
exports.loadFile = function(filename, tagHandlers, callback) {
  if (typeof tagHandlers === 'function') {
    callback = tagHandlers;
    tagHandlers = {};
  }

  fs.readFile(filename, 'utf-8', function(err, data) {
    if (err) callback(err, null);
    else callback(null, exports.load(data, tagHandlers));
  });
};

// Synchronous version of loadFile.
exports.loadFileSync = function(filename, tagHandlers) {
  var data = fs.readFileSync(filename, 'utf-8');
  return exports.load(data, tagHandlers);
};

// Allow direct requiring of YAML files.
require.extensions[".yaml"] = require.extensions[".yml"] = function (module) {
   module.exports = exports.loadFileSync(module.filename);
};


// Helper function that emits a serialized version of the given item.
var serialize = function(emitter, item) {
  // FIXME: throw on circulars
  switch (typeof item) {
    case "string":
      emitter.scalar(item);
      break;
    case "object":
      if (!item) {
        emitter.scalar('~');
      }
      else if (item instanceof Date) {
        emitter.scalar(item.toISOString());
      }
      else if (item.length) {
        emitter.sequence(function() {
          var length = item.length;
          for (var i = 0; i < length; i++)
            serialize(emitter, item[i]);
        });
      }
      else {
        emitter.mapping(function() {
          for (var p in item) {
            if (Object.hasOwnProperty.call(item, p)) {
              emitter.scalar(p);
              serialize(emitter, item[p]);
            }
          }
        });
      }
      break;
    case "number":
      if (item === Infinity)
        emitter.scalar(".inf");
      else if (item === -Infinity)
        emitter.scalar("-.inf");
      else if (isNaN(item))
        emitter.scalar(".NaN");
      else
        emitter.scalar(String(item));
      break;
    default:
      emitter.scalar(String(item));
      break;
  }
};

// The `dump` function serializes its arguments to YAML. Any number of arguments may be provided,
// and the arguments should be plain JavaScript objects, arrays or primitives. Each argument is
// treated as a single document to serialize. The return value is a string.
exports.dump = function() {
  var documents = arguments, chunks = [], emitter;
  emitter = new exports.stream.createEmitter(function(chunk) {
    chunks.push(chunk);
  });
  emitter.stream(function() {
    var length = documents.length;
    for (var i = 0; i < length; i++) {
      var document = documents[i];
      emitter.document(function() {
        serialize(emitter, document);
      });
    }
  });
  return chunks.join('');
};

// Helper for quickly writing out a file.
exports.dumpFile = function(filename) {
  var documents = Array.prototype.slice.call(arguments, 1),
      numDocuments = documents.length,
      callback;
  if (numDocuments !== 0 && typeof documents[numDocuments - 1] === 'function')
    callback = documents.pop();

  var data = exports.dump.apply(this, documents);
  fs.writeFile(filename, data, callback);
};

// Synchronous version of dumpFile.
exports.dumpFileSync = function(filename) {
  var documents = Array.prototype.slice.call(arguments, 1);

  var data = exports.dump.apply(this, documents);
  fs.writeFileSync(filename, data);
};
