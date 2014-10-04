
(function(mod) {
  if (typeof exports == "object" && typeof module == "object") return mod(exports); // CommonJS
  if (typeof define == "function" && define.amd) return define(["exports"], mod); // AMD
  mod(this.AnalyzeCode = {}); // Plain browser env
})(function(exports) {

  // utility
  var constructObjectReference = function(node) {
    var string = "";
    if(node.type == "MemberExpression") {
      string = node.object.name + "." + constructObjectReference(node.property)
    } else {
      string = node.name;
    }
    return string;
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
  };

  // templates
  // note: Regexs are strings so they can be concatenated together to clean out all process functions at once
  var callTemplate = _.template("__processCall(\"<%=  name %>\",<%= name %>, <%= start %>, <%= end %>, <%= contents %>)");
  exports.callStringRegexStart = "__processCall\([^;]*\)";

  var valuesTemplate = _.template("__processValue(<%= contents %>, <%= stringified %>, <%= start %>, <%= end %>)");
  exports.valuesStringRegex = "__processValue\([^;]*\)";

  var wrapperTemplate = _.template("<span class='<%= type %> expression' data-start='<%= start %>' data-end='<%= end %>'><%= contents %></span>");

  var loopTemplate = _.template(";__processLoop(<%= start %>, <%= end %>);");
  exports.loopStringRegex = ";__processLoop\([^;]*\);";

  var startCallTemplate = _.template(";__processStartCall(<%= start %>, <%= end %>);");
  exports.startCallStringRegex = ";__processStartCall\([^;]*\);";

  // node processing
  var processAssignment = function(node) {
    var name;
    if(node.left.type == "MemberExpression") {
      name = node.left.object.name || "this";
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

  // other functionality
  var scopeVariable = exports.scopeVariable = function(scope, name) {
    var found = false;
    while(!found && scope) {
      found = scope.variables[name];
      scope = scope.parent;
    }
    return found;
  };

  var findVariableDefinition = function(name, state) {
    if(state.variables[name]) {
      return state.variables[name];
    } else {
      return findVariableDefinition(name, state.parent);
    }
  };

  var findVariablesInNode = function(/* nodes */) {
    return _.reduce(findIdentifiers.apply(this, arguments), function(memo, node) {
      memo[node.name] = node;
      return memo;
    }, {});
  };

  var findIdentifiers = function(/* nodes */) {
    var identifiers = [];
    _.each(arguments, function(node) {
      acorn.walk.recursive(node, "", {
        MemberExpression: function(node, state, c) {
          var lookup = constructObjectReference(node.property);
          c(node.object, lookup);
        },
        Identifier: function(node, state, c) {
          if(state) node.lookup = state;
          identifiers.push(node);
        }
      });
    });
    return identifiers;
  };

  // for coloring values consistently
  var colorSpace = parseInt("ffffff", 16);
  var step = colorSpace / 20;
  step += step / 5;
  var stepIteration = 0;

  var makeColor = function() {
    var decimal = Math.floor(colorSpace % 1 + (step * stepIteration++));
    var hex = decimal.toString(16);
    while(hex.length < 6) {
      hex = "0" + hex;
    }
    return hex;
  }


  // entry point into functionality, "new" to use
  var Processor = exports.Processor = function(code) {
    var copiedCode = code,
        renderedCode = code,
        timeline = [],
        wrap = new Wrap(),
        renderWrap = new Wrap();

    var processValue = function(value, object, start, end) {
      if(!_.isFunction(value) && _.isObject(value)) {
        value = lodash.cloneDeep(value);
      }

      var processed = {
        value: value,
        type: "value",
        start: start,
        end: end
      };

      timeline.push(processed);

      return value;
    };

    var processCall = function(name, func, start, end, content) {
      var index = timeline.length - 1;
      while(index) {
        var moment = timeline[index];
        if(moment.temp) {
          _.extend(moment, {name: name, func: func, start: start, end: end, type: "call"});
          delete moment.temp;
          return content;
        }
        index--;
      }
      // throw new Error("could not find start of call");
      return content;
    };

    var processStartCall = function(start, end) {
     timeline.push({temp: true, defstart: start, defend: end});
    };

    var seen = {};
    var processLoop = function(start, end) {
      var hash = start + "x" + end;
      seen[hash] === void 0 ?  seen[hash] = 0 : seen[hash]++;
      timeline.push({type: "loop", start: start, end: end, iteration: seen[hash]});
    };

    // string / code manipulation functions
    var append = function(index, object, template) {
      object || (object = {});
      _.extend(object, {index: index});
      copiedCode = wrap.append(copiedCode, index, template, object);
    };

    var wrapCode = function(start, end, template, config) {
      copiedCode = wrap.wrap(copiedCode, start, end, template, config);
    };

    var wrapValue = function(start, end, scope, name, position) {
      if(_.isEmpty(object)) return;

      var stringified = "";

      if(!position) {
        position = {start: start, end: end};
      }

      var variable = scopeVariable(scope, name);

      stringified = "{" + variable.gid + ": {position: " + JSON.stringify(position) + ", name: \"" + name + "\"}" + "}";
      wrapCode(start, end, valuesTemplate, {stringified: stringified, start: start, end: end});
    };

    var htmlize = function(node) {
      renderedCode = renderWrap.wrap(renderedCode, node.start, node.end, wrapperTemplate, {
        type: node.type,
        end: node.end,
        start: node.start
      });
    };

    var markIdentifiers = function(/* nodes */) {
      _.each(findIdentifiers.apply(this, arguments), htmlize);
    };

    // actual processing
    var AST = this.AST = acorn.parse(code);

    var base = {children: [], expressions: [], variables: {}, parent: null, start: 0, end: code.length};

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

        _.each(node.params, function(node) {
          node.gid = _.uniqueId("var");
          newstate.variables[node.name] = node;
          c(node, state);
        });

        // generalize later
        var bodyStart = node.body.body[0].start - 1;
        append(bodyStart, {start: node.start, end: node.end}, startCallTemplate);
        wrapValue(node.start, node.end, newstate, newstate.variables);

        state.children.push(newstate);
        node.state = newstate;

        htmlize(node);

        htmlize(node.body);
        c(node.body, newstate);
      },
      WhileStatement: function(node, state, c) {
        htmlize(node);
        var startOfBody = node.body.start + 1;

        append(startOfBody, node, loopTemplate);
        c(node.test, state);
        c(node.body, state);
      },
      BlockStatement: function(node, state, c) {
        htmlize(node);
        _.each(node.body, function(node) {
          c(node, state);
        });
      },
      // loop statements are complicated because we cant insert the tracking code insitu...
      ForStatement: function(node, state, c) {
        htmlize(node);
        var startOfBody = node.body.start + 1;
        append(startOfBody, node, loopTemplate);

        markIdentifiers(node.init, node.update, node.test);

        c(node.init, state);
        c(node.test, state);
        c(node.update, state);
        c(node.body, state);
      },
      VariableDeclaration: function(node, state, c) {
        var processed = processDeclaration(node);
        state.expressions.push(processed);

        _.each(node.declarations, function(node) {
          processed.declarations[node.id.name] = node.id;
          node.gid = _.uniqueId("var");
          state.variables[node.id.name] = node;

          node.color = makeColor();
          
          var passIn = {};
          passIn[node.id.name] = node;

          wrapValue(node.init.start, node.init.end, state, passIn);

          c(node.id, state);
          if(node.init) c(node.init, state);
        });
        htmlize(node);
      },
      AssignmentExpression: function(node, state, c) {
        // todo: need to track undeclared variables as they become globals
        var assignment = processAssignment(node);
        state.expressions.push(assignment);
        wrapValue(node.start, node.end, state, findVariablesInNode(node.left));
        htmlize(node);
        c(node.left, state);
        c(node.right, state);
      },
      UpdateExpression: function(node, state, c) {
        var update = processUpdate(node);
        wrapValue(node.start, node.end, state, update.name);
        state.expressions.push(update);
        htmlize(node);
        c(node.argument, state);
      },
      CallExpression: function(node, state, c) {
        var object = {
          name: node.callee.name,
          end: node.end,
          start: node.start
        };
        wrapCode(node.start, node.end, callTemplate, object);
        htmlize(node);
        c(node.callee, state);

        _.each(node.arguments, function(arg) {
          c(arg, state);
        });
      },
      Identifier: function(node, state, c) {
        htmlize(node);
      },
      MemberExpression: function(node, state, c) {
        htmlize(node);
      }
    });

    // this needs to be moved into a web worker or something to not pollute and conflict
    try {
      var func = new Function("__processValue", "__processCall", "__processLoop, __processStartCall", copiedCode);
      func = _.bind(func, {});

      func(processValue, processCall, processLoop, processStartCall);
    } catch(e) {
      console.error(e);
    }

    this.timeline = timeline;
    this.length = length;
    this.transformedCode = copiedCode;
    this.code = code;
    this.renderedCode = renderedCode;
    this.scope = base;
  };

  var Wrap = function() {
    this.offsets = [];
  };

  _.extend(Wrap.prototype, {
    wrap: function(string, start, end, template, config) {
      var fixedStart = this.fixPosition(start);
      var fixedEnd = this.fixPosition(end);
      var contents = string.slice(fixedStart, fixedEnd),
          templated = template(_.extend({contents: "#$%^&" + contents}, config));

      var index = templated.indexOf("#$%^&" + contents);
      templated = templated.replace("#$%^&", "");
      if(!!~index) {
        this.offsets[start] = (this.offsets[start] || 0) + index;
        this.offsets[end] = (this.offsets[end] || 0) + templated.length - (index + contents.length);
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

