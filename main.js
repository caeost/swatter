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
  
  var processCode = function(__code, __values, __originalCode) {
    var __processValue = function(valueObject, lineNumber) {
      var variables = _.reduce(valueObject, function(memo, value, name) {
        if(!_.isFunction(value) && _.isObject(value)) {
          memo[name] = lodash.cloneDeep(value);
        } else {
          memo[name] = value;
        }
        return memo;
      }, {});
      __values.push({zeroedLineNumber: lineNumber, variables: variables, type: "values"});
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
  var offsets = {};
  var wrap = function(string, start, end, template, config) {
    _.extend(config, {contents: contents});
    var contents = string.slice(start, end),
        templated = _.template(template, config);

    offsets[start] = templated.length - contents.length;
    return string.substring(0, start) + templated + string.substring(end);
  };

  var append = function(string, index, template, config) {
    return wrap(string, index, index, template, config);
  };

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
  var callTemplate = "(__processCall(<%= (lineNumber - 1) %>,\"<%=  name %>\",<%= contents %>))";

  var valuesTemplate = ";__processValue(<%= JSON.stringify(lodash.zipObject(names, names)) %>, <%= lineNumber - 1 %>);";
  exports.valuesStringRegex = /;__processValue\(.*\);/g;


  exports.Processor = function(code) {
    var copiedCode = code,
        values = [],
        nodes = [];
  
    var AST = acorn.parse(code, {locations: true});

    var save = function(node) {
      nodes.push(node);
    };

    acorn.walk.simple(AST, {
      AssignmentExpression: save,
      VariableDeclaration: save,
      UpdateExpression: save,
      CallExpression: save
    });

    var isCall = _.matches({type: "CallExpression"});
    var callOrNot = _.partition(nodes, isCall);

    _.each(callOrNot[0], function(node) {
      var templateConfig = {name: node.callee.name, lineNumber: node.loc.start.line};
      copiedCode = wrap(copiedCode, node.start, node.end, callTemplate, templateConfig);
    });

    var nodesOnLines = _.chain(callOrNot[1])
      .map(function(node) {
        var name, names, lineNumber;
        switch(node.type) {
          case "AssignmentExpression":
            if(node.left.type == "MemberExpression") {
              names = [constructObjectReference(node.left)];
            } else {
              names = [node.left.name];
            }
            lineNumber = node.loc.end.line;
            break;
          case "VariableDeclaration":
            names = pluck(node.declarations, "id.name");
            lineNumber = node.loc.end.line;
            break;
          case "UpdateExpression":
            names = [node.argument.name];
            lineNumber = node.argument.loc.end.line;
            break;
          default:
            debugger;
            return null;
        }
        return {
          lineNumber: lineNumber,
          names: names,
          node: node
        }
      })
      .groupBy("lineNumber")
      .value();

    _.each(nodesOnLines, function(array, lineNumber) {
      // not all too pretty..
      var end = Math.max.apply(this, pluck(array, "node.end"));
      var names = _.compact(Array.prototype.concat.apply(_.pluck(array, "name"), _.pluck(array, "names")));
      debugger;
      var config = {
        names: names,
        lineNumber: lineNumber
      };
      copiedCode = append(copiedCode, end, valuesTemplate, config);
    });

    // this needs to be moved into a web worker or something to not pollute and conflict
    processCode(copiedCode, values, code, this);

    var alreadySeen = {};
    values = _.map(values, function(value) {
      var lineNumber = value.zeroedLineNumber;
      var existing = alreadySeen[lineNumber] || 0;
      alreadySeen[lineNumber] = value.lineRepeat = existing + 1;
      return value;
    });

    this.values = values;
    this.AST = AST;
    this.transformedCode = copiedCode;
    this.originalCode = code;
    this.lookupOriginalChunk = _.partial(LookupOriginalChunk, code);
  };
});

