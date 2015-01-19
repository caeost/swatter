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

  // unused right now
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

  // unused right now
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
      this.get('timeline').reset(processor.timeline);

      delete processor['timeline'];

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

  // ACE editor
  var editor = ace.edit("editor");
  //editor.setTheme("ace/theme/monokai");
  editor.getSession().setMode("ace/mode/javascript");
  editor.on('change', _.debounce(function() {
    var text = editor.getValue();

    var processor = new AnalyzeCode.Processor(text);
    model.set(model.parse(processor));

    // debugging
    console.log(model.get('timeline').toJSON());

    window.localStorage.editorValue = text;
  }, 100));

  if(window.localStorage.editorValue) {
    editor.setValue(window.localStorage.editorValue);
  }

  var model = window.model = new Model(); 
  var codeView = new CodeView({
    el: $inputArea.find("#displayArea"), 
    model: model
  });

  $("#SubmitButton").click(function() {
    $inputArea.addClass("ViewMode");
  });

  $("#EditButton").click(function() {
    $inputArea.removeClass("ViewMode");
  });

  $("#colorVars").change(function() {
    model.set("colorVars", $(this).prop("checked"));
  });
});

