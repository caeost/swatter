(function(mod) {
  if (typeof exports == "object" && typeof module == "object") return mod(exports); // CommonJS
  if (typeof define == "function" && define.amd) return define(["exports"], mod); // AMD
  mod(this.AnalyzeCode = {}); // Plain browser env
})(function(exports) {
  
  var ForAssignment = function(assignmentsPerLine, node) {
    var assigned;
    switch(node.left.type) {
      case "MemberExpression":
        assigned = node.left.object;
        break;
      default:
        assigned = node.left;
    }

    var name = assigned.name;
    if(!name) return;
    var lineNumber = node.loc.end.line;
    assignmentsPerLine[lineNumber] || (assignmentsPerLine[lineNumber] = []);
    assignmentsPerLine[lineNumber].push({name: assigned.name, loc: node.right.loc});
  };
  
  var ForDeclaration = function(assignmentsPerLine, node) {
    var declarations = node.declarations;
    for(var i = 0, len = declarations.length; i < len; i++) {
      var declaration = declarations[i];
      if(!declaration.id.name) continue;
      var lineNumber = node.loc.end.line;
      assignmentsPerLine[lineNumber] || (assignmentsPerLine[lineNumber] = []);
      assignmentsPerLine[lineNumber].push({name: declaration.id.name, loc: declaration.init.loc});
    }
  };

  var ForUpdate = function(assignmentsPerLine, node) {
    var assigned = node.argument;
    if(!assigned.name) return;
    var lineNumber = assigned.loc.end.line;
    assignmentsPerLine[lineNumber] || (assignmentsPerLine[lineNumber] = []);
    assignmentsPerLine[lineNumber].push({name: assigned.name, loc: assigned.loc});
  };

  exports.extendStringRegex = /; __values.push\({variables: {.*}\); /g;

  var produceValuesExtendString = function(lineNumber, variables) {
    var length = variables.length,
        properties = [];
    for(var i = 0; i < length; i++) {
      var name = variables[i].name;
      var loc = JSON.stringify(variables[i].loc);
      properties.push(name + ": {value: __processRawValue(" + name + ", " + loc + "), loc:" + loc + "}"); 
    }
    return "; __values.push({variables: { " + properties.join(", ") + "}, zeroedLineNumber: " + (lineNumber - 1) + "}); ";
  };

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
    var __processRawValue = function(value, loc) {
      // this is getting the function after its been marked up
      // need to get back the original function value..
      if(!_.isFunction(value) && _.isObject(value)) {
        return _.clone(value);
      } else {
        return value;
      }
    }
    try {
      eval(__code);
    } catch(e) {
      console.error(e);
    }
  };

  exports.Processor = function(code) {
    var lines = code.split("\n"),
        copiedLines = _.clone(lines),
        values = [],
        assignmentsPerLine = {};
  
    var AST = acorn.parse(code, {locations: true});
  
    var forAssignment = _.partial(ForAssignment, assignmentsPerLine);
    var forDeclaration = _.partial(ForDeclaration, assignmentsPerLine);
    var forUpdate = _.partial(ForUpdate, assignmentsPerLine);

    acorn.walk.simple(AST, {
      AssignmentExpression: forAssignment,
      VariableDeclaration: forDeclaration,
      UpdateExpression: forUpdate
    });

    _.each(assignmentsPerLine, function(variables, lineNumber) {
      var zeroOffsetLine = lineNumber - 1;
      copiedLines[zeroOffsetLine] += produceValuesExtendString(lineNumber, variables);
    });

    var copiedCode = copiedLines.join("\n");

    processCode(copiedCode, values, code);

    var alreadySeen = {};
    values = _.map(values, function(value) {
      var lineNumber = value.zeroedLineNumber;
      var existing = alreadySeen[lineNumber] || 0;
      alreadySeen[lineNumber] = value.lineRepeat = existing + 1;
      return value;
    });

    this.values = values;
    this.AST = AST;
    this.length = lines.length;
    this.assignmentsPerLine = assignmentsPerLine;
    this.transformedCode = copiedCode;
    this.originalCode = code;
    this.lookupOriginalChunk = _.partial(LookupOriginalChunk, code);
  };
});

