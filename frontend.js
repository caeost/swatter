$(function() {
  var $variables = $("#variables");
  var $inputArea = $("#InputArea");
  var $slider = $("#slider");

  var stringifyTransformer = function(censor) {
    return function(key, value) {
      if(key && typeof(censor) === 'object' && typeof(value) == 'object' && censor === value) {
        return '[Circular]';
      }
      return _.isFunction(value) ? value.toString() : value;
    };
  };

  // returns back an htmlized version of value for viewing
  var renderValue = function(value, prevVariable) {
    var result = value;
    if(_.isFunction(value)) {
      result = value.toString().replace(AnalyzeCode.valuesStringRegex, "$1");
    } else if(_.isObject(value)) {
      result = JSON.stringify(value, stringifyTransformer(value), "\t");
    } else if(_.isString(result) && prevVariable) {
      var renderedPrevious = renderValue(prevVariable.value, prevVariable);
      // later need to use the actual backbone semantics for change but hey its v.0000001
      if(_.isString(renderedPrevious) && renderedPrevious !== result) {
        result = diffString(renderedPrevious, result);
      }
    } 
    if(_.isString(result)) {
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
      var numberValues = _.filter(variables, _.isNumber);

      if(numberValues.length) {
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
      this.collection = options.collection;
    },
    events: {
      "click .name": "clickName",
      "change #variableFilter": "filterVariables"
    },
    clickName: function(e) {
      var $this = $(e.target);
      var name = $this.text();
      var allValuesForName = this.collection.reduce(function(memo, model) {
        var variable = model.get("variables")[name];
        if(variable !== void 0) {
          memo.push({value: variable, lineNumber: model.get("zeroedLineNumber")});
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
    template: _.template("<input type='text' id='variableFilter' value='<%- filterText %>'/><% _.each(variables, function(value, name) { %><div class='variable'><span class='name'><%- name %></span>: <span class='value'><%= renderValue(value, previousModel.get(name)) %></span></div><% }); %>"),
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
        renderValue: renderValue,
        previousModel: model.previousState,
        variables: variables,
        filterText: filterText
      }));
    }
  });

  var CodeView = Backbone.View.extend({
    height: 700,
    initialize: function(options) {
      if(options.model) {
        this.listenTo(options.model, "change:selectedLine", function(model, line) {
          var $lines = this.$(".line").removeClass("active");
          var $line = $lines.eq(line).addClass("active");

          var $pre = this.$("pre");
          $pre.scrollTop($pre.scrollTop() + ($line.offset().top - (this.height / 2)));
        });
        this.listenTo(options.model, "change:text", this.render);
      }
    },
    events: {
      "click .line": "clickLine"
    },
    clickLine: function(e) {
    },
    template: _.template("<pre class='code'><code class='javascript'><% _.each(lines, function(line, i) { %><span class='line'><span class='line-number'><%- i + 1 %></span><%= line %></span>\n<% }); %></code></pre>"),
    render: function() {
      var text = hljs.highlight("javascript", this.model.get("text")).value;
      this.$el.html(this.template({lines: text.split("\n")}));
    }
  });

  var CodeCSSView = Backbone.View.extend({
    initialize: function(options) {
      if(options.model) {
        this.listenTo(options.model, "change:text", this.render);
      }
    },
    tagName: "style",
    template: _.template(" .line-number { width: <%- lineWidth %>px;}"),
    render: function() {
      var lineWidth = (this.model.get("processor").length + "").length * 10;
      this.$el.html(this.template({lineWidth: lineWidth}));
    }
  });

  var Model = Backbone.Model.extend({
    initialize: function() {
      this.set("state", new Backbone.Model);
      this.set("previousState", new Backbone.Model);

      // these are not really "previous" in terms of backbone as they can be skipped over so this..
      // could be made so if we wanted to set them before, but doesnt seem worth it right now
      this.get("state").previousState = this.get("previousState");

      this.set("values", new Backbone.Collection);

      var createObject = function(chunk) {
        var obj = {};
        obj[chunk.get("name")] = chunk.get("value");
        return obj;
      };

      // index is the main control mechanism for looking through the code,
      // it corresponds to which variable change is going on
      this.on("change:index", function(model, index, options) {
        var values = this.get("values");
        var valueChunk = values.at(index);
        var variables = createObject(valueChunk);
        
        // need to make sure state reflects all the things that have changed
        var previous = this.previous("index");
        this.get("state").clear();
        this.get("previousState").clear();

        var counter = index - 1;
        var previousVariables;
        if(counter >= 0) {
          previousVariables = createObject(values.at(counter));
          _.defaults(variables, previousVariables);
        }
        // note: previous state is not line based so changing multiple things in one line
        // will make it appear to ignore changes on earlier lines
        this.get("previousState").set(previousVariables || {});
        // sucks to have to do all of this everytime, should optmiize later
        while(--counter >= 0) {
          _.defaults(variables, createObject(values.at(counter)));
        }
        // this is a little dirty right now but hey
        var inScope = this.lookupVariables(valueChunk.get("start"));
        this.get("state").set(_.pick(variables, _.keys(inScope)));
        
        if(!options || !options.slider) {
          $slider[0].value = index;
        }
        this.set("selectedLine", this.lookupLine(valueChunk.get("start")) - 1);
      });
      
      this.on("change:processor", function(model, processor) {
        this.get("values").reset(processor.values);
        this.set("functions", processor.nodes.functions);
        this.set("nodes", processor.nodes.nodes);
        this.set("scope", processor.scope);
        this.set("linePositions", processor.linePositions);
      });
    },
    lookupVariables: function(position) {
      var func = _.chain(this.get("functions"))
        .filter(function(node) {
          return node.start <= position && node.end > position;
        })
        .sortBy("start")
        .first()
        .value();
      
      var variables = {};
      var state = func ? func.state : this.get("scope");
      while(state != null) {
        _.defaults(variables, state.variables);
        state = state.parent;
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
  var codeCSSView = new CodeCSSView({el: $("#CodeCSSView"), model: model});
  var detailView = new DetailView({el: $("#detailDisplay"), eventSource: variableView});

  $("#SubmitButton").click(function() {
    $inputArea.addClass("ViewMode");

    var text = $inputArea.find("#box").val();

    var processor = new AnalyzeCode.Processor(text);
    
    model.set("processor", processor);
    model.set("text", text);

    $slider.prop("max", processor.values.length - 1);
    
    model.set("index", 0);
  });

  $("#EditButton").click(function() {
    $inputArea.removeClass("ViewMode");
  });

  $slider.on("input change", function() {
    var value = +$(this).val();
    model.set("index", value, {slider: true});
  });
});

