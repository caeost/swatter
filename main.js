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
    var __processValue = function(name, value, start, end) {
      // this looks kinda weird but its because stuff like i++ return different value then what i actually is
      var evaled = eval(name);
      value = evaled === void 0 ? value : evaled;
      if(!_.isFunction(value) && _.isObject(value)) {
        value = lodash.cloneDeep(value);
      }
      __values.push({name: name, value: value, type: "values", start: start, end: end});
      return value;
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

  var valuesTemplate = "__processValue(\"<%= name %>\",( <%= contents %>), <%= start %>, <%= end %>)";
  exports.valuesStringRegex = /__processValue\(.*,\( (.*)\),.*\)/g;

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
      name: node.id.name,
      node: node.init
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
        values = [],
        nodes = [],
        calls = [],
        functions = [];
  
    this.offsets = [];

    var AST = acorn.parse(code, {locations: true});

    var global = {variables: [], children: [], parent: null};

    acorn.walk.recursive(AST, global, {
      FunctionExpression: function(node, state, c) { 
        var newstate = {
          variables: {},
          children: [],
          parent: state
        };
        state.children.push(newstate);
        node.state = newstate;
        functions.push(node);
        c(node.body, newstate);
      },
      VariableDeclaration: function(node, state, c) {
        _.each(node.declarations, function(node) {
          var processed = processDeclaration(node);
          state.variables[processed.name] = node;
          node.gid = _.uniqueId("var");
          nodes.push(processed);

          c(node.id, state);
          c(node.init, state);
        });
      },
      AssignmentExpression: function(node, state, c) {
        nodes.push(processAssignment(node));
        c(node.left, state);
        c(node.right, state);
      },
      UpdateExpression: function(node, state, c) {
        nodes.push(processUpdate(node));
        c(node.argument, state);
      },
      CallExpression: function(node) {
        calls.push(node);
      }
    });

    _.each(calls, function(node) {
      var templateConfig = {name: node.callee.name, lineNumber: node.loc.start.line};
      copiedCode = this.wrap(copiedCode, node.start, node.end, callTemplate, templateConfig);
    }, this);

    _.chain(nodes)
      // i think this should require less offset juggling... will see what performance trade off is
      .sortBy(function(node) {
        return -node.start;
      })
      .each(function(object) {
        var start = object.node.start;
        var end = object.node.end;
        var config = {
          start: start,
          end: end,
          name: object.name
        };
        copiedCode = this.wrap(copiedCode, start, end, valuesTemplate, config);
      }, this);

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
    this.scope = global;
    this.nodes = {
      nodes: nodes,
      calls: calls,
      functions: functions
    };
  };

  _.extend(Processor.prototype, {
    wrap: function(string, start, end, template, config) {
      var fixedStart = this.fixPosition(start);
      var fixedEnd = this.fixPosition(end);
      var contents = string.slice(fixedStart, fixedEnd),
          templated = _.template(template, _.extend({contents: contents}, config));
    
      // ugh
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

