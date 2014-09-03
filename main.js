
(function(mod) {
  if (typeof exports == "object" && typeof module == "object") return mod(exports); // CommonJS
  if (typeof define == "function" && define.amd) return define(["exports"], mod); // AMD
  mod(this.AnalyzeCode = {}); // Plain browser env
})(function(exports) {

  var LookupOriginalChunk = exports.LookupOriginalChunk = function(originalCode, loc) {
    var start = loc.start,
        end = loc.end,
        lines = originalCode.split("\n");

    // lines are not 0 index
    start.line--;
    end.line--;
    var chunk = [lines[start.line].substr(start.column)];
    var counter = start.line;
    while(++counter < end.line) {
      chunk.push(lines[counter]);
    }
    chunk.push(lines[end.line].substr(0, end.column));
    return chunk.join("\n");
  };
  
  var processCode = function(__code, __values) {
    var __processValue = function(object , index) {
      var processed = {
        type: "value",
        index: index
      };

      processed.values = _.reduce(object, function(memo, value, key) {
        if(!_.isFunction(value) && _.isObject(value)) {
          value = lodash.cloneDeep(value);
        }
        memo[key] = value;
        return memo;
      }, {});

      __values.push(processed);
    };
    var __processCall = function(lineNumber, name, result) {
      var variables = {};
      variables[name] = result;
      __values.push({variables: variables, zeroedLineNumber: lineNumber, type: "call"});
      return result;
    };

    try {
      eval(__code);
    } catch(e) {
      console.error(e);
    }
  };

  // utility
  var constructObjectReference = function(node) {
    var string = "";
    if(node.object.type == "MemberExpression") {
      string = constructObjectReference(node.object)
    } else {
      string = node.object.name;
    }
    return string + "." + node.property.name;
  };

  var pluck = function(collection, key) {
    var route = key.split(".");
    return _.map(collection, function(object) {
        var i = 0,
            current = object;
        while(current && i < route.length) {
          current = current[route[i]]
          i++;
        }
        return current;
      });
  }


  // templates
  var callTemplate = "__processCall(<%= (lineNumber - 1) %>,\"<%=  name %>\",<%= contents %>)";

  var valuesTemplate = ";__processValue(<%= stringified %>, <%= index %>);";
  exports.valuesStringRegex = /;__processValue\(.*\);/g;

  // node processing
  var processAssignment = function(node) {
    var name;
    if(node.left.type == "MemberExpression") {
      name = node.left.object.name;
    } else {
      name = node.left.name;
    }
    return {
      node: node,
      name: name
    }
  };
  var processDeclaration = function(node) {
    return {
      declarations: {},
      node: node
    }
  };
  var processUpdate = function(node) {
    return {
      name: node.argument.name,
      node: node
    }
  };
  
  // entry point into functionality, "new" to use
  var Processor = exports.Processor = function(code) {
    var copiedCode = code,
        values = [];
  
    this.offsets = [];

    var AST = acorn.parse(code, {locations: true});

    var base = {children: [], expressions: [], variables: {}, parent: null, start: 0, end: code.length};

    var append = _.bind(function(index, object) {
      var stringified = "";
      if(!_.isObject(object)) {
        var name = object;
        object = {};
        object[name] = true;
      }
      var keys = _.map(object, function(value, key) {
        return key + ":" + key;
      });
      stringified = "{" + keys.join(",") + "}";
      copiedCode = this.append(copiedCode, index, valuesTemplate, {stringified: stringified, index: index});
    }, this);

    acorn.walk.recursive(AST, base, {
      FunctionExpression: function(node, state, c) {
        var newstate = {
          children: [],
          expressions: [],
          variables: {},
          parent: state,
          start: node.start,
          end: node.end
        };
        state.children.push(newstate);
        node.state = newstate;
        c(node.body, newstate);
      },
      VariableDeclaration: function(node, state, c) {
        var processed = processDeclaration(node);
        state.expressions.push(processed);

        _.each(node.declarations, function(node) {
          processed.declarations[node.id.name] = node;
          node.gid = _.uniqueId("var");
          state.variables[node.id.name] = node;

          c(node.id, state);
          c(node.init, state);
        });
        append(node.end, processed.declarations);
      },
      AssignmentExpression: function(node, state, c) {
        var assignment = processAssignment(node);
        state.expressions.push(assignment);
        append(node.end, assignment.name);
        c(node.left, state);
        c(node.right, state);
      },
      UpdateExpression: function(node, state, c) {
        var update = processUpdate(node);
        append(node.end, update.name);
        state.expressions.push(update);
        c(node.argument, state);
      }
    });

    // this needs to be moved into a web worker or something to not pollute and conflict
    processCode(copiedCode, values);

    var alreadySeen = {};
    values = _.map(values, function(value) {
      var start = value.start;
      var existing = alreadySeen[start] || 0;
      alreadySeen[start] = value.repeat = existing + 1;
      return value;
    });

    var linePositions = [0];
    var length = 1;
    var last = 0;
    while(true) {
      var index = code.indexOf("\n", last) + 1;
      if(index == 0) break;
      linePositions.push(index);
      last = index;
      length++;
    }

    this.values = values;
    this.linePositions = linePositions;
    this.length = length;
    this.AST = AST;
    this.transformedCode = copiedCode;
    this.originalCode = code;
    this.lookupOriginalChunk = _.partial(LookupOriginalChunk, code);
    this.scope = base;
  };

  _.extend(Processor.prototype, {
    wrap: function(string, start, end, template, config) {
      var fixedStart = this.fixPosition(start);
      var fixedEnd = this.fixPosition(end);
      var contents = string.slice(fixedStart, fixedEnd),
          templated = _.template(template, _.extend({contents: contents}, config));

      var index = templated.indexOf(contents);
      if(!!~index) {
        this.offsets[start] = (this.offsets[start] || 0) + index;
        this.offsets[end] = (this.offsets[start] || 0) + templated.length - (index + contents.length);
      } else {
        this.offsets[start] = (this.offsets[start] || 0) + templated.length - contents.length;
      }

      return string.substring(0, fixedStart) + templated + string.substring(fixedEnd);
    },
    append: function(string, index, template, config) {
      return this.wrap(string, index, index, template, config);
    },
    fixPosition: function(line) {
      var offsets = this.offsets.slice(0, line +1);
      if(offsets.length) {
        var offset = _.reduce(offsets, function(memo, val) {
          return memo += val;
        },0);
        return line + offset;
      } else {
        return line;
      }
    }
  });
});

