$(function() {
  var $variables = $("#variables");
  var $inputArea = $("#InputArea");
  var $slider = $("#slider");

  // returns back an htmlized version of value for viewing
  var renderValue = function(value, variable, prevVariable) {
    var result = value;
    if(_.isFunction(value)) {
      result = value.toString();
    } else if(_.isObject(value)) {
      result = JSON.stringify(value, void 0, true);
    }
    if(_.isString(result)) {
      result = result.replace(AnalyzeCode.extendStringRegex, "");
      if(prevVariable) {
        var renderedPrevious = renderValue(prevVariable.value, prevVariable);
        // later need to use the actual backbone semantics for change but hey its v.0000001
        if(_.isString(renderedPrevious) && renderedPrevious !== result) {
          result = diffString(renderedPrevious, result);
        }
      }
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
      var numberValues = _.chain(variables)
                            .pluck("value")
                            .filter(_.isNumber)
                            .value();
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
        this.listenTo(options.model, "change", function(model) {
          var attributes = model.toJSON();
          this.render({variables: attributes, renderValue: renderValue, previousModel: model.previousState});
        });
      }
      this.collection = options.collection;
    },
    events: {
      "click .name": "clickName"
    },
    clickName: function(e) {
      var $this = $(e.target);
      var name = $this.text();
      var allValuesForName = this.collection.reduce(function(memo, model) {
        var variable = model.get("variables")[name];
        if(variable !== void 0) {
          memo.push({value: variable.value, lineNumber: model.get("zeroedLineNumber")});
        }
        return memo;
      }, []);
      this.trigger("nameClicked", name, allValuesForName);
    },
    template: _.template("<% _.each(variables, function(variable, name) { %><div class='variable'><span class='name'><%- name %></span>: <%= renderValue(variable.value, variable, previousModel.get(name)) %></div><% }); %>"),
    render: function(data) {
      this.$el.html(this.template(data));
    }
  });

  var CodeView = Backbone.View.extend({
    initialize: function(options) {
      if(options.model) {
        this.listenTo(options.model, "change:selectedLine", function(model, line) {
          this.$(".line").removeClass("active").eq(line).addClass("active");
        });
        this.listenTo(options.model, "change:text", this.render);
      }
    },
    events: {
      "click .line": "clickLine"
    },
    clickLine: function(e) {
      var $target = $(e.target);
      this.model.set("index", $target.index() - 1);
    },
    template: _.template("<pre class='code'><code class='javascript'><% _.each(lines, function(line, i) { %><span class='line'><span class='line-number'><%- i + 1 %></span><%= line %></span>\n<% }); %></code></pre>"),
    render: function() {
      var text = hljs.highlight("javascript", this.model.get("text")).value;
      this.$el.html(this.template({lines: text.split("\n")}));
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

      // index is the main control mechanism for looking through the code,
      // it corresponds to which variable change is going on
      this.on("change:index", function(model, line, options) {
        var values = this.get("values");
        var valueChunk = values.at(line);
        var variables = _.clone(valueChunk.get("variables"));
       
        // need to make sure state reflects all the things that have changed
        var previous = this.previous("index");
        if(previous > line) {
          this.get("state").clear();
          previous = 0;
        }
        var counter = line - 1;
        var previousVariables;
        if(counter >= 0) {
          previousVariables = values.at(counter).get("variables");
          _.defaults(variables, previousVariables);
        }
        this.get("previousState").set(previousVariables || {});
        // can use just one _.defaults here as it can take arbitrary arguments
        while(previous <= --counter) {
          _.defaults(variables, values.at(counter).get("variables"));
        }
        this.get("state").set(variables);
        
        if(!options || !options.slider) {
          $slider[0].value = line;
        }
        this.set("selectedLine", valueChunk.get("zeroedLineNumber"));
      });
      this.on("change:processor", function(model, processor) {
        this.get("values").reset(processor.values);
      });
      this.listenTo(this.get("values"), "reset", function() {
        
      });
    }
  });

  var model = window.model = new Model(); 
  var variableView = new VariableView({model: model.get("state"), collection: model.get("values"), el: variables});
  var codeView = new CodeView({el: $inputArea.find("#displayArea"), model: model});
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

  $slider.change(function() {
    var value = +$(this).val();
    model.set("index", value, {slider: true});
  });
});

