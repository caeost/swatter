$(function() {
  var $variables = $("#variables");
  var $inputArea = $("#InputArea");
  var $slider = $("#slider");

  var stringifyTransformer = function(censor) {
    return function(key, value) {
      if(key && typeof(censor) === 'object' && typeof(value) == 'object' && censor === value) {
        return '[Circular]';
      }
      return _.isFunction(value) ? value.toString().replace(AnalyzeCode.valuesStringRegex, "") : value;
    };
  };

  // returns back an htmlized version of value for viewing
  var renderValue = function(value, prevVariable, raw) {
    var result = value;
    if(_.isFunction(value)) {
      result = value.toString().replace(AnalyzeCode.valuesStringRegex, "");
    } else if(_.isObject(value)) {
      result = JSON.stringify(value, stringifyTransformer(value), "\t");
    } else if(_.isString(value) && prevVariable) {
      var renderedPrevious = renderValue(prevVariable.value);
      // later need to use the actual backbone semantics for change but hey its v.0000001
      if(_.isString(renderedPrevious) && renderedPrevious !== result) {
        result = diffString(renderedPrevious, result);
      }
    } 
    if(!raw && _.isString(result)) {
      result = hljs.highlight("javascript", result).value;
    }
    return result;
  };

  var DetailView = Backbone.View.extend({
    initialize: function(options) {
      // eventsource could become an array
      if(options.eventSource) {
        this.listenTo(options.eventSource, "nameClicked", this.render);
      }
    },
    events: {
      "mouseover .value": "hoverValue"
    },
    hoverValue: function(e) {
      var $target = $(e.target);
      var line = $target.data("line");
      // show which line?
    },
    // highlight objects and functions
    template: _.template($("#detailTemplate").text()),
    render: function(name, variables) {
      this.$el.html(this.template({name: name, variables: variables, renderValue: renderValue}));
      var numbersNSuch = _.chain(variables)
                            .pluck("value")
                            .partition(_.isNumber)
                            .value();

      if(numbersNSuch[0].length) {
        d3.select("#detailDisplay .contextual")
          .selectAll("div")
            .data(numberValues)
          .enter().append("div")
            .style("width", function(d) { return d * 10 + "px"; })
            .text(function(d) { return d; });
      }

    }
  });

  var VariableView = Backbone.View.extend({
    initialize: function(options) {
      options || (options = {});
      if(options.model) {
        this.listenTo(options.model, "change", this.render);
      }
    },
    events: {
      "click .name": "clickName",
      "change #variableFilter": "filterVariables"
    },
    clickName: function(e) {
      var $this = $(e.target);
      var name = $this.text();
      var allValuesForName = this.collection.reduce(function(memo, model) {
        var value = model.get("values")[name];
        if(value !== void 0) {
          memo.push({value: value, lineNumber: model.get("zeroedLineNumber")});
        }
        return memo;
      }, []);
      this.trigger("nameClicked", name, allValuesForName);
    },
    filterVariables: function(e) {
      var filter = this.$("#variableFilter").val();
      this.filter = new RegExp(filter);
      this.filterText = filter;
      this.render();
    },
    template: _.template($("#variableTemplate").text()),
    render: function() {
      var model = this.model;

      var variables = model.toJSON();
      var filter = this.filter;
      if(filter) {
        variables = _.reduce(variables, function(memo, value, key) {
          if(filter.test(key)) {
            memo[key] = value;
          }
          return memo;
        }, {});
      }

      var filterText = this.filterText;
      this.$el.html(this.template({
        model: model,
        renderValue: renderValue,
        variables: variables,
        filterText: filterText
      }));
    }
  });

  var CodeView = Backbone.View.extend({
    height: 700,
    initialize: function(options) {
      if(options.model) {
        this.listenTo(options.model, "change:currentModel", function(m, model) {
          this.$(".active").removeClass("active");
          var start = model.get("start");
          var end = model.get("end");
          var $value = this.$("[data-start='" + start + "'][data-end='" + end + "']");

          $value.addClass("active");

          var $pre = this.$("pre");
          $pre.scrollTop($pre.scrollTop() + ($value.offset().top - (this.height / 2)));
        });
        this.listenTo(options.model, "change:rendered", this.render);
      }
    },
    events: {
      "click .line": "clickLine",
      "click .CallExpression .Identifier": "clickCall"
    },
    clickLine: function(e) {
    },
    clickCall: function(e) {
      var $call = $(e.target).closest(".CallExpression");
      var start = $call.data("start");
      var call = _.find(model.get("calls"), function(c) { return c.start == start;});
      var rendered = renderValue(call.func, false, true);
      rendered = "(" + rendered + ")";
      var output = renderVariableValues(rendered, this.model.get("values"), start);
      console.log(output);
    },
    template: _.template($("#codeTemplate").text()),
    render: function() {
      var code = this.model.get("rendered");
      var length = this.model.get("processor").length;
      this.$el.html(this.template({
        code: code,
        length: length
      }));
      hljs.highlightBlock(this.el);
    }
  });

  var Model = Backbone.Model.extend({
    initialize: function() {
      this.set("state", new Backbone.Model);

      // should use line number as id attribute
      this.set("values", new Backbone.Collection);

      // index is the main control mechanism for looking through the code,
      // it corresponds to which variable change is going on
      this.on("change:index", function(model, index, options) {
        var values = this.get("values");
        var valueModel = values.at(index);
        var position = valueModel.get("index");
        var variables = {};
        
        this.get("state").clear();

        var counter = 0;
        while(counter <= index) {
          _.extend(variables, values.at(counter).get("values"));
          counter++;
        }
        // this is a little dirty right now but hey
        var inScope = this.lookupVariables(position);
        this.get("state").set(_.pick(variables, _.keys(inScope)));
        
        // todo: make slider view and move this there
        if(!options || !options.slider) {
          $slider[0].value = index;
        }
        this.set("currentModel", valueModel);
      });
      
      this.on("change:processor", function(model, processor) {
        this.get("state").clear();
        this.get("values").reset(processor.values);
        this.set("calls", processor.calls);
        this.set("scope", processor.scope);
        this.set("linePositions", processor.linePositions);
        this.set("text", processor.code);
        this.set("rendered", processor.renderedCode);
        this.set("index", -1, {silent: true});
        this.set("index", 0);
      });
    },
    lookupVariables: function(position) {
      var variables = {},
          scope = this.get("scope");
      while (scope) {
        _.extend(variables, scope.variables);
        scope = _.find(scope.children, function(scope) {
          return scope.start <= position && scope.end > position;
        });
      }

      return variables;
    },
    lookupLine: function(position) {
      var positions = this.get("linePositions");
      var line = -1;
      var index = 0;
      while(position >= index) {
        line++;
        index = positions[line];
      }
      return line;
    },
    lookupVariablesByLine: function(lineNumber) {
      var position = this.get("linePositions")[lineNumber];
      return this.lookupVariables(position);
    }
  });

  var model = window.model = new Model(); 
  var variableView = new VariableView({model: model.get("state"), collection: model.get("values"), el: variables});
  var codeView = new CodeView({el: $inputArea.find("#displayArea"), model: model});
  var detailView = new DetailView({el: $("#detailDisplay"), eventSource: variableView});

  // very basic at this point, makes a bunch of assumptions
  var renderVariableValues = function(text, values, index) {
    var copy = text,
        list = [],
        offset = 0;

    var wrap = function(string, start, end, template, config) {
      start = start + offset;
      end = end + offset;
      var contents = string.slice(start, end),
          templated = _.template(template, _.extend({contents: contents}, config));
    
      offset += templated.length - contents.length;
      return string.substring(0, start) + templated + string.substring(end);
    };
    var lookupLast = function(position, name) {
      var possible = values.filter(function(model) { return model.get("index") < (position - 1)}).reverse();
      var i = 0;
      while(i < possible.length) {
        var model = possible[i];
        var variable = model.get("values")[name];
        if(variable) return renderValue(variable, false, true);
        i++;
      }
      return "ERROR";
    };

    acorn.walk.recursive(acorn.parse(text), false, {
      AssignmentExpression: function(node, state, c) { 
        c(node.right, true);
      },
      UpdateExpression: function(node, state, c) {
        c(node.argument, true);
      },
      FunctionExpression: function(node, state, c) {
        c(node.body, false);
        _.each(node.params, function(param) {
          c(param, true);
        });
      },
      VariableDeclaration: function(node, state, c) {
        _.each(node.declarations, function(node) {
          c(node.init, true);
        });
      },
      Identifier: function(node, state, c) {
        if(state) {
          list.push(node);
        }
      }
    });

    list = _.sortBy(list, "start");

    _.each(list, function(val) {
      var start = index + val.start;
      copy = wrap(copy, val.start, val.end, "{<%= lookupLast(start, contents) %>}", {lookupLast: lookupLast, start: start});
    });
    
    return copy;
  };

  window.renderVariableValues = renderVariableValues;


  $("#SubmitButton").click(function() {
    $inputArea.addClass("ViewMode");

    var text = $inputArea.find("#box").val();

    var processor = new AnalyzeCode.Processor(text);
    model.set("processor", processor);

    $slider.prop("max", processor.values.length - 1);
  });

  $("#EditButton").click(function() {
    $inputArea.removeClass("ViewMode");
  });

  $slider.on("input change", function() {
    var value = +$(this).val();
    model.set("index", value, {slider: true});
  });
});

