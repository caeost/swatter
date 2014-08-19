(function(mod) {
  if (typeof exports == "object" && typeof module == "object") return mod(exports); // CommonJS
  if (typeof define == "function" && define.amd) return define(["exports"], mod); // AMD
  mod(this.AnalyzeCode = {}); // Plain browser env
})(function(exports) {
  
  var ForAssignment = function(assignmentsPerLine, node) {
    var assigned = node.left;
    if(!assigned.name) return;
    var lineNumber = assigned.loc.end.line;
    assignmentsPerLine[lineNumber] || (assignmentsPerLine[lineNumber] = []);
    assignmentsPerLine[lineNumber].push(assigned.name);
  };
  
  var ForDeclaration = function(assignmentsPerLine, node) {
    var declarations = node.declarations;
    for(var i = 0, len = declarations.length; i < len; i++) {
      var declaration = declarations[i].id;
      if(!declaration.name) continue;
      var lineNumber = node.loc.end.line;
      assignmentsPerLine[lineNumber] || (assignmentsPerLine[lineNumber] = []);
      assignmentsPerLine[lineNumber].push(declaration.name);
    }
  };

  var produceValuesExtendString = function(lineNumber, assignments) {
    var length = assignments.length;
    var properties = _.reduce(assignments, function(memo, name, index) {
      var save = (name + ": " + "__processRawValue(" + name + ")");
      if(index < (length - 1)) {
        save += ", ";
      }
      return memo + save;
    }, "")
  
    return "; __values.push({variables: { " + properties + "}, lineNumber: " + (lineNumber - 1) + "}); ";
  };
  
  var processCode = function(__code, __values) {
    var __processRawValue = function(value) {
      // this is getting the function after its been marked up
      // need to get back the original function value..
      if(_.isFunction(value)) {
        return value.toString();
      } else if(_.isObject(value)) {
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
  }
  // this needs a few changes (As well as online above, and the html file)
  //
  // Once thats all working it would also be nice to have a data first view. 
  // Being able to see all the lines where a variable changed value, and what
  // changed about it. Adding syntax higlighting (highlight.js natch), and an editor would be 
  // nice. The buttons should definitely be replaced by a scrubber. from there move onto
  // the other desired features in my debugger checklist...
  exports.Processor = function(code) {
    var lines = code.split("\n"),
        copiedLines = _.clone(lines),
        values = [],
        assignmentsPerLine = {};
  
    var AST = acorn.parse(code, {locations: true});
  
    var forAssignment = _.partial(ForAssignment, assignmentsPerLine);
    var forDeclaration = _.partial(ForDeclaration, assignmentsPerLine);

    acorn.walk.simple(AST, {
      AssignmentExpression: forAssignment,
      VariableDeclaration: forDeclaration
    });

    _.each(assignmentsPerLine, function(variables, lineNumber) {
      var zeroOffsetLine = lineNumber - 1;
      copiedLines[zeroOffsetLine] += produceValuesExtendString(lineNumber, variables);
    });

    var copiedCode = copiedLines.join("\n");

    processCode(copiedCode, values);

    this.values = values;
    this.AST = AST;
    this.length = lines.length;
    this.assignmentsPerLine = assignmentsPerLine;
    this.transformedCode = copiedCode;
    this.originalCode = code;
  };
});

