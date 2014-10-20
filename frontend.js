$(function() {
  var $variables = $("#variables");
  var $inputArea = $("#InputArea");
  var $slider = $("#slider");

  var trackingStringRegex = AnalyzeCode.callStringRegexStart + "|" + AnalyzeCode.valuesStringRegex + "|" + AnalyzeCode.loopStringRegex + "|" + AnalyzeCode.startCallStringRegex;

  // http://stackoverflow.com/questions/3938099/inversing-dom-with-jquery
  (function($) {
    $.fn.reverseOrder = function() {
        return this.each(function() {
            $(this).prependTo( $(this).parent() );
        });
    };
  })(jQuery);

  // ACE editor
  var editor = ace.edit("editor");
  //editor.setTheme("ace/theme/monokai");
  editor.getSession().setMode("ace/mode/javascript");

  var stringifyTransformer = function(censor) {
    return function(key, value) {
      if(key && typeof(censor) === 'object' && typeof(value) == 'object' && censor === value) {
        return '[Circular]';
      }
      return _.isFunction(value) ? value.toString().replace(trackingStringRegex, "") : value;
    };
  };

  // returns back an htmlized version of value for viewing
  // todo: improve rendering of literals, wrapping strings etc, so that they can get nicely colored and stuff
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

  // inlining values, showing results of branch statements etc. + detailed views like graphs
  // Also being able to change literals values could be useful for seeing whats going on.
  var CodeView = Backbone.View.extend({
    height: 700,
    initialize: function(options) {
      if(options.model) {
        this.listenTo(options.model, "change:renderedCode", this.render);
        this.listenTo(options.model, "change:peek", function(model, peek) {
           this.peek(peek, this.$el);
        });
      }
    },
    peek: function(peek, $el) {
      $el.find(".Identifier:not(.write), .MemberExpression:not(.write)").each(function() {
          var $this = $(this);
          if(peek) {
            $this.text($this.data("display"));
          } else {
            $this.text($this.data("textdisplay"));
          }
        });
    },
    events: {
      "click .CallExpression .Identifier": "clickCall",
      "hover .object, .array": "hoverObject",
      "input .scrubber": "scrub",
      "mousedown .scrubber": "peekLoop",
      "mouseup .scrubber": "unpeekLoop"
    },
    clickCall: function(e) {
      var $call = $(e.target).closest(".CallExpression");
      $call.toggleClass("inline-call");
      this.peek(true, $call.find(".BlockStatement"));
    },
    hoverObject: function(e) {
      var $target = $(e.target);

    },
    scrub: function(e) {
      var $target = $(e.target),
          className = $target.data("loop"),
          value = +$target.val();

      var loopHolder = this.$(".loop." + className);
      loopHolder.find(".ForStatement, .WhileStatement").hide().eq(value).show();
    },
    peekLoop: function(e) {
      var $loop = $(e.target).closest(".loop");
      this.peek(true, $loop);
    },
    unpeekLoop: function(e) {
      var $loop = $(e.target).closest(".loop");
      this.peek(false, $loop);
    },
    template: _.template($("#codeTemplate").text()),
    // v 0.0000001
    markupValues: function() {
      var cursor,
          table = {};

      var functions = this.model.get("functions");
      var lookupScope = function(start, end) {
        // speed up later, it is sorted after all
        var possible = _.filter(functions, function(f) {
          return f.start <= start && f.end > end;
        });

        return possible.pop();
      };

      var followPath = function(object, path) {
        var route = path.split("."),
            i = 0,
            current = object;
        while(current && i < route.length) {
          current = current[route[i]]
          i++;
        }
        return current;
      };

      var handleIdentifier = function(element) {
        var $element = $(element),
          name = $element.text(),
          start = $element.data("start"),
          end = $element.data("end"),
          dotIndex = name.indexOf("."),
          path;

        if(!!~dotIndex) {
          path = name.substr(dotIndex + 1);
          name = name.substr(0, dotIndex);
        }

        var scope = lookupScope(start, end);
        var variable = AnalyzeCode.scopeVariable(scope, name);
        if(variable) {
          var valueObject = table[variable.gid];
          if(valueObject) {
            var value = valueObject.value,
                display = value,
                className = "";

            if(!!~dotIndex) {
              value = followPath(value, path);
              display = value;
            }

            if(_.isFunction(display)) {
              display = valueObject.name;
              className = "function"
            } else if(_.isArray(display)) {
              display = "[..]";
              className = "array";
            } else if(_.isObject(display)) {
              display = "{..}"
              className = "object";
            } else if(_.isNumber(display)) {
              className = "number";
            } else if(_.isString(display)) {
              className = "string";
            }

            $element
              .addClass(className)
              .data("display", display)
              .data("value", value)
              .data("textdisplay", $element.text())
              .data("name", name);

            if(model.get("colorVars")) {
              $element.css("color", variable.color);
            }
          }
        }
      };

      // timeline is now a heterogenous structure of different kinds of values
      var timeline = this.model.get("timeline").toJSON();
      var expressions = this.$(".expression");

      var i = 0;
      while(i < expressions.length) {
        var $element = expressions.eq(i),
            start = $element.data("start"),
            end = $element.data("end"),
            head = timeline[0];
        
        // this means that the marking up of expressions can diverge from the timeline
        // but timelined expressions should always appear in html, kinda also makes sense
        // cause why else track them?
        if(head && head.start == start && head.end == end) {
          timeline.shift();
          // put in new values into hash
          if(head.type == "value") {
            _.each(head.values, function(value, gid) {
              table[gid] = value;
            });
          // splice in loop bodies
          } else if(head.type == "loop") {
            var clone = $element.clone(true);
            clone
              .addClass("clone")
              .data("iteration", head.iteration)
            $element.before(clone);
            expressions.splice.apply(expressions, [i, 0, clone[0]].concat(clone.find(".expression").toArray()));
          } else if(head.type == "call" || head.type == "new") {
            var definition = expressions.filter("[data-start='" + head.defstart + "'][data-end='" + head.defend + "']").eq(0);
            var clone = definition.clone();
            clone.addClass("cloned-call");
            $element.append(clone);
            expressions.splice.apply(expressions, [i + 1, 0, clone[0]].concat(clone.find(".expression").toArray()));
            if(head.type == "new") {
              // figure this out
            }
          } else if(head.type == "iftest") {
            var className = head.className;
            if(head.result) {
              $element.find(".consequent." + className).addClass("selected");
            } else {
              var $alternate = $element.find(".alternate." + className);
              if(!$alternate.is(".IfStatement")) {
                $alternate.addClass("selected");
              }
            }
          }
        }

        // actual marking of values happens here
        if($element.is(".Identifier, .MemberExpression")) {
          handleIdentifier($element);
        }
        i++;
      }
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

      // by this point loops are unrolled
      var loopTemplate = this.loopTemplate;
      this.$(".WhileStatement:not(.clone), .ForStatement:not(.clone)").each(function() {
        var $this = $(this);

        var id = _.uniqueId("loop");
        var clones = $this.prevUntil(":not(.clone)");
        
        clones
          .wrapAll("<div class='loop " + id + "'>")
          .reverseOrder()
          .hide()
          // the list is reversed but the selection isn't so last == first
          .last().show().end()
          .parent()
            .prepend(loopTemplate({id: id, max: clones.length - 1}));

        // remove original
        $this.remove();
      });
    },
    loopTemplate: _.template("<div class='scrubber'><input type='range' value='0' max='<%= max %>' data-loop='<%= id %>'></div>")
  });

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
      
      var scope = processor.scope;
      var buildList = function(scope) {
        var list = [];
        list.push(scope);
        _.each(scope.children, function(child) {
          list = list.concat(buildList(child));
        });
        return list;
      };
      var functionList = buildList(scope);
      processor.functions = _.sortBy(functionList, "start");

      return processor;
    }
  });

  var model = window.model = new Model(); 
  var variableView = new VariableView({model: model.get("state"), collection: model.get("values"), el: variables});
  var codeView = new CodeView({el: $inputArea.find("#displayArea"), model: model});
  var detailView = new DetailView({el: $("#detailDisplay"), eventSource: variableView});

  $("#SubmitButton").click(function() {
    $inputArea.addClass("ViewMode");

    var text = editor.getValue();

    var processor = new AnalyzeCode.Processor(text);
    model.set(model.parse(processor));
  });

  $("#EditButton").click(function() {
    $inputArea.removeClass("ViewMode");
  });

  $("#colorVars").change(function() {
    model.set("colorVars", $(this).val() === "on");
  });
});

