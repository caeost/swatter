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

  // plan is to change this quite a bit, showing the variables underneath is not wholly useful.
  // instead inlining values, showing results of branch statements etc. + detailed views like graphs
  // per variable seem more powerful. How exactly this should look is still unknown. the sliders will
  // probably move into the areas where loops exist, as the temporal flow of the program is already evident
  // from the structure of the code ( could also be made more evident by function inlining later) so scrubbing
  // through that is of questionable use. Scrubbing across different iterations of a loop inline would be nice.
  // Also being able to change literals values could be useful for seeing whats going on.
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
        this.listenTo(options.model, "change:renderedCode", this.render);
        this.listenTo(options.model, "change:peek", function(model, peek) {
          this.$(".Identifier").each(function() {
            var $this = $(this),
                val = $this.data("value");
            if(peek) {
              $this.text(val);
            } else {
              $this.text($this.data("name"));
            }
          }); 
        });
      }
    },
    events: {
      "click .CallExpression .Identifier": "clickCall"
    },
    clickCall: function(e) {
      var $call = $(e.target).closest(".CallExpression");
      var start = $call.data("start");
      var call = _.find(model.get("timeline"), function(c) { return c.start == start;});
      var rendered = renderValue(call.func, false, true);
      rendered = "(" + rendered + ")";
      var output = renderVariableValues(rendered, this.model.get("timeline"), start);
      console.log(output);
    },
    template: _.template($("#codeTemplate").text()),
    markupValues: function() {
      var cursor;

      // timeline is now a heterogenous structure of different kinds of values, fix
      this.model.get("timeline").each(function(val) {
        var start = val.get("start"),
            end = val.get("end"),
            type = val.get("type"),
            // could get rid of these repeated re searches if we added cloned nodes to the list as we go
            expressions = this.$(".expression");

        if(type == "loop" && val.get("iteration")) {
          var el = expressions.filter("[data-start='" + start + "'][data-end='" + end + "']").last();
          var clone = el.clone(true);
          clone.addClass("clone");
          // todo fix
          clone.data("iteration", val.get("iteration"));
          el.after(clone);
        } else if(type == "value") {
          var values = val.get("values");
          _.each(values, function(value, name) {
            var minimum = cursor ? expressions.slice($.inArray(cursor[0], expressions) + 1) : expressions;
            var node = minimum.filter("[data-start='" + value.position.start + "'][data-end='" + value.position.end + "']").eq(0);
            cursor = node;
            if(!node.length) throw new Error("node not found for value that exists");
            node
              .data("value", value.value)
              .data("name", name);
          });
        }
      }, this);
    },
    render: function() {
      var code = this.model.get("renderedCode");
      // no line numbers for right now cause i cant decide what to do
      // kinda gnarls
      //code = code.replace(/\n/g, "\n<span class='line-number'></span>");
      //code = "<span class='line-number'></span>" + code;
      this.$el.html(this.template({
        code: code,
      }));
      hljs.highlightBlock(this.el);
     // this.$(".line-number").each(function(i) { 
     //   $(this).text(i + 1);
     // });
      this.markupValues();

      // testing
      this.$(".WhileStatement:not(.clone)").before(whileTemplate());
    }
  });

  var whileTemplate = _.template("<div class='scrubber'><input type='range' value='0'></div>");

  var Model = Backbone.Model.extend({
    initialize: function() {
      this.set("timeline", new Backbone.Collection);

      var model = this;
      $("body").keydown(function(e) { 
          if(e.which == 16) { 
            model.set("peek", true); 
          } 
        })
        .keyup(function(e) { 
          if(e.which == 16) {
            model.set("peek", false);
          } 
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
    parse: function(processor) {
      processor.timeline = new Backbone.Collection(processor.timeline);
      return processor;
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
    model.set(model.parse(processor));
  });

  $("#EditButton").click(function() {
    $inputArea.removeClass("ViewMode");
  });
});

