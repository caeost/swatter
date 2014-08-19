$(function() {
  var $variables = $("#variables");
  var $inputArea = $("#InputArea");
  var $slider = $("#slider");

  var renderValue = function(value) {
    if(_.isObject(value)) {
      return JSON.stringify(value);
    }
    return value;
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
        this.model = options.model;
        this.listenTo(options.model, "change", function(model) {
          var attributes = model.toJSON();
          this.render({variables: attributes, renderValue: renderValue});
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
        var value = model.get("variables")[name];
        if(value) {
          memo.push({value: value, lineNumber: model.get("lineNumber")});
        }
        return memo;
      }, []);
      this.trigger("nameClicked", name, allValuesForName);
    },
    template: _.template("<% _.each(variables, function(value, name) { %><div class='variable'><span class='name'><%- name %></span>: <%- renderValue(value) %></div><% }); %>"),
    render: function(data) {
      this.$el.html(this.template(data));
    }
  });

  var CodeView = Backbone.View.extend({
    initialize: function(options) {
      if(options.model) {
        this.model = options.model;
        this.listenTo(options.model, "change:selectedLine", function(model, line) {
          this.$(".line").removeClass("active").eq(line).addClass("active");
        });
        this.listenTo(options.model, "change:text", this.render);
      }
    },
    template: _.template("<pre class='code'><code class='javascript'><%- text %></code></pre>"),
    render: function() {
      this.$el.html(this.template({text: this.model.get("text")}));

      // messy shouldn't need to render before highlight js maybe
      var $code = this.$("code");
      hljs.highlightBlock($code[0]);
      var linedUp = _.map($code.html().split("\n"), function(line) { 
        return "<span class='line'>" + line + "</span>";
      });
      $code.html(linedUp.join("\n"));
    }
  });

  var Model = Backbone.Model.extend({
    initialize: function() {
      this.set("state", new Backbone.Model);
      this.set("values", new Backbone.Collection);
      this.on("change:index", function(model, line, options) {
        var values = this.get("values");
        var valueChunk = values.at(line);
        var variables = _.clone(valueChunk.get("variables"));

        // need to make sure state reflects all the things that have changed
        var previous = this.previous("index");
        if(previous > line) {
          previous = 0;
        }
        var counter = line
        while(previous <= --counter) {
          _.defaults(variables, values.at(counter).get("variables"));
        }

        if(!options || !options.slider) {
          $slider[0].value = line;
        }
        this.get("state").set(variables);
        this.set("selectedLine", valueChunk.get("lineNumber"));
      });
      this.on("change:processor", function(model, processor) {
        this.get("values").reset(processor.values);
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

