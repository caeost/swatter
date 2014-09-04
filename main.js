
(function(mod) {
  if (typeof exports == "object" && typeof module == "object") return mod(exports); // CommonJS
  if (typeof define == "function" && define.amd) return define(["exports"], mod); // AMD
  mod(this.AnalyzeCode = {}); // Plain browser env
})(function(exports) {

  var processCode = function(code, values, calls) {

    var processValue = function(object, index) {
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

      values.push(processed);
    };

    var processCall = function(name, func, index) {
      calls.push({name: name, func: func, index: index});
    };

    try {
      var func = new Function("__processValue", "__processCall", code);
      func = _.bind(func, {});

      func(processValue, processCall);
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
  var callTemplate = _.template(";__processCall(\"<%=  name %>\",<%= name %>, <%= index %>);");
  exports.callStringRegex = /;__processCall\(.*\);/

  var valuesTemplate = _.template(";__processValue(<%= stringified %>, <%= index %>);");
  exports.valuesStringRegex = /;__processValue\(.*\);/g;

  var wrapperTemplate = _.template("<span class='<%= type %>'><%= contents %></span>");

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
  
  // entry point into functionality, "new" to use
  var Processor = exports.Processor = function(code) {
    var copiedCode = code,
        renderedCode = code,
        values = [],
        calls = [],
        wrap = new Wrap(),
        renderWrap = new Wrap();
  
    var AST = acorn.parse(code, {locations: true});

    var base = {children: [], expressions: [], variables: {}, parent: null, start: 0, end: code.length};

    var append = function(index, object, template) {
      object || (object = {});
      _.extend(object, {index: index});
      copiedCode = wrap.append(copiedCode, index, template, object);
    };

    var appendValue = function(index, object) {
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
      append(index, {stringified: stringified}, valuesTemplate);
    };

    // testing
    var htmlize = function(node) {
      renderedCode = renderWrap.wrap(renderedCode, node.start, node.end, wrapperTemplate,{type: node.type});
    };

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
          newstate.variables[node.name] = node;
        });

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
          if(node.init) c(node.init, state);
        });
        appendValue(node.end, processed.declarations);
        htmlize(node);
      },
      AssignmentExpression: function(node, state, c) {
        // todo: need to track undeclared variables as they become globals
        var assignment = processAssignment(node);
        state.expressions.push(assignment);
        appendValue(node.end, assignment.name);
        htmlize(node);
        c(node.left, state);
        c(node.right, state);
      },
      UpdateExpression: function(node, state, c) {
        var update = processUpdate(node);
        appendValue(node.end, update.name);
        state.expressions.push(update);
        htmlize(node);
        c(node.argument, state);
      },
      CallExpression: function(node, state, c) {
        var object = {
          name: node.callee.name,
          index: node.end
        };
        append(node.end, object, callTemplate);
        htmlize(node);
        c(node.callee, state);
      }
    });

    // this needs to be moved into a web worker or something to not pollute and conflict
    processCode(copiedCode, values, calls);

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
    this.calls = calls;
    this.linePositions = linePositions;
    this.length = length;
    this.AST = AST;
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
          templated = template(_.extend({contents: contents}, config));

      var index = templated.indexOf(contents);
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

