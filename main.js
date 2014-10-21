
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

  var valuesTemplate = _.template(";__processValue(<%= stringified %>, <%= start %>, <%= end %>);");
  exports.valuesStringRegex = ";__processValue\([^;]*\);";

  var wrapperTemplate = _.template("<span class='<%= type %> expression' data-start='<%= start %>' data-end='<%= end %>'><%= contents %></span>");

  var loopTemplate = _.template(";__processLoop(<%= start %>, <%= end %>);");
  exports.loopStringRegex = ";__processLoop\([^;]*\);";

  var startCallTemplate = _.template(";__processStartCall(<%= start %>, <%= end %>, this);");
  exports.startCallStringRegex = ";__processStartCall\([^;]*\);";

  var testTemplate = _.template("__processTest(<%= start %>, <%= end %>, \"<%= className %>\", <%= contents %>)");

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

    var processValue = function(object, start, end) {
      var processed = {
        type: "value",
        start: start,
        end: end
      };

      processed.values = _.reduce(object, function(memo, value, key) {
        if(!_.isFunction(value) && _.isObject(value)) {
          value = lodash.cloneDeep(value);
        }
        // might need to save the explicit position as right now only the expressions position is saved
        memo[key] = value;
        return memo;
      }, {});

      timeline.push(processed);
    };

    var processCall = function(name, func, start, end, content, type) {
      var index = timeline.length - 1;
      while(index) {
        var moment = timeline[index];
        if(moment.temp) {
          _.extend(moment, {name: name, func: func, start: start, end: end, type: type || "call"});
          delete moment.temp;
          return content;
        }
        index--;
      }
      // throw new Error("could not find start of call");
      return content;
    };

    var processStartCall = function(start, end, that) {
     timeline.push({temp: true, defstart: start, defend: end, that: that});
    };

    var processTest = function(start, end, className, result) {
      timeline.push({type: "iftest", start: start, end: end, className: className, result: result});
      return result;
    };

    var seen = {};
    var processLoop = function(start, end) {
      var hash = start + "x" + end;
      seen[hash] === void 0 ?  seen[hash] = 0 : seen[hash]++;
      timeline.push({type: "loop", start: start, end: end, iteration: seen[hash]});
    };

    // string / code manipulation functions
    var append = function(index, object, template) {
      if(!template) {
        template = object;
        object = {};
      } else if(!object) {
        object = {};
      }
      _.extend(object, {index: index});
      copiedCode = wrap.append(copiedCode, index, template, object);
    };

    var wrapCode = function(start, end, template, config) {
      copiedCode = wrap.wrap(copiedCode, start, end, template, config);
    };

    var appendValue = function(index, start, end, scope, object, position) {
      var stringified = "";
      if(!_.isObject(object)) {
        var name = object;
        object = {};
        object[name] = position;
      }
      if(_.isEmpty(object)) return;
      var properties = _.map(object, function(value, key) {
        var name,
            variable = scopeVariable(scope, key);
        if(variable) {
          name = variable.gid;
        } else {
          throw new Error("cannot find variable in scope");
        }
        return name + ": {value: " + key + ",position: " + JSON.stringify(value) + ", name: \"" + key + "\"}";
      });
      stringified = "{" + properties.join(",") + "}";
      append(index, {stringified: stringified, start: start, end: end}, valuesTemplate);
    };

    var htmlize = function(node, extraType) {
      renderedCode = renderWrap.wrap(renderedCode, node.start, node.end, wrapperTemplate, {
        type: node.type + (extraType ? " " + extraType  : ""),
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
        appendValue(bodyStart, node.start, node.end, newstate, newstate.variables);

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
        appendValue(startOfBody, node.body.start, node.body.end, state, findVariablesInNode(node.test));
        c(node.test, _.extend({block: true}, state));
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

        c(node.init, _.extend({block: true}, state));
        c(node.update, _.extend({block: true}, state));
        appendValue(startOfBody, node.body.start, node.body.end, state, findVariablesInNode(node.update, node.init));
        c(node.body, state);
      },
      VariableDeclaration: function(node, state, c) {
        htmlize(node);
        var processed = processDeclaration(node);
        state.expressions.push(processed);

        _.each(node.declarations, function(node) {
          processed.declarations[node.id.name] = node.id;
          node.gid = _.uniqueId("var");
          state.variables[node.id.name] = node;

          node.color = makeColor();

          c(node.id, state);
          if(node.init) c(node.init, state);
        });
        if(!state || !state.block) appendValue(node.end, node.start, node.end, state, processed.declarations);
      },
      AssignmentExpression: function(node, state, c) {
        htmlize(node);
        // todo: need to track undeclared variables as they become globals
        var assignment = processAssignment(node);
        state.expressions.push(assignment);
        c(node.left, state);
        c(node.right, state);
        appendValue(node.end, node.start, node.end, state, findVariablesInNode(node.left));
      },
      UpdateExpression: function(node, state, c) {
        htmlize(node);
        var update = processUpdate(node);
        if(!state || !state.block)  {
          appendValue(node.end, node.start, node.end, state, update.name, {start: node.argument.start, end: node.argument.end});
        } else {
          //wrapValue(node.start, node.end, state, update.name, node.argument);
        }
        state.expressions.push(update);
        c(node.argument, state);
      },
      // todo: built in functions are somehow getting the defstart / defend of parent functions, fix that
      CallExpression: function(node, state, c) {
        htmlize(node);
        var object = {
          name: constructObjectReference(node.callee),
          end: node.end,
          start: node.start
        };
        wrapCode(node.start, node.end, callTemplate, object);
        c(node.callee, state);

        _.each(node.arguments, function(arg) {
          c(arg, state);
        });
      },
      NewExpression: function(node, state, c) {
        htmlize(node);
        var object = {
          name: constructObjectReference(node.callee),
          end: node.end,
          start: node.start
        };
        wrapCode(node.start, node.end, callTemplate, object, "new");
        c(node.callee, state);

        _.each(node.arguments, function(arg) {
          c(arg, state);
        });
      },
      IfStatement: function(node, state, c) {
        htmlize(node);
        var test = node.test,
            className = _.uniqueId("IfStatement");
        wrapCode(test.start, test.end, testTemplate, {start: node.start, end: node.end, className: className});
        htmlize(node.consequent, "consequent " + className);
        c(test, state);
        c(node.consequent, state);
        if(node.alternate) {
          htmlize(node.alternate, "alternate " + className);
          c(node.alternate, state);
        }
      },
      Identifier: function(node, state, c) {
        if(!scopeVariable(state, node.name)) {
          // this is messed up because its a different "this" each time in new objects hmm
          if(node.name === "this") {
            node.gid = _.uniqueId("this");
          } else {
            node.global = true;
            node.gid = _.uniqueId("global");
            base.variables[node.name] = node;
          }
          node.color = makeColor();
        }
        htmlize(node);
      },
      MemberExpression: function(node, state, c) {
        htmlize(node);
      },
      Literal: function(node, state, c) {
        htmlize(node);
      }
    });

    // this needs to be moved into a web worker or something to not pollute and conflict
    try {
      var func = new Function("__processValue", "__processCall", "__processLoop, __processStartCall", "__processTest", copiedCode);
      func = _.bind(func, {});

      func(processValue, processCall, processLoop, processStartCall, processTest);
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

