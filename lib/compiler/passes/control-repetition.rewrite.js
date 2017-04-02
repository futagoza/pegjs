"use strict";

let GrammarError = require("../../grammar-error");
let asts = require("../asts");
let visitor = require("../visitor");

let __hasOwnProperty = Object.prototype.hasOwnProperty;

const TYPES_NAMES = {
  increment_match: "incrementer",
  decrement_match: "decrementer"
};

function isRepeater(node) {
  return typeof node === "object" && (
    node.type === "zero_or_more" || node.type === "one_or_more"
  );
}

function position(node) {
  let filename = node.location.filename;
  let start = node.location.start;

  return (filename ? filename + " " : "")
    + start.line + ":" + start.column;
}

// Does 2 things during the pass:
//
// 1. Checks that only acceptable expressions are {in/de}crementing.
// 2. Create new rules and refrences to them by expanding {in/de}crement nodes
//
// Before the pass is finshed, it should add the new rules to the ast
function controlRepetition(ast) {
  let repeaters = {};
  let newRules = [];

  function findRule(node) {
    return asts.findRule(ast, node.name);
  }

  function evaluate(node) {
    let mode = TYPES_NAMES[node.type];
    let expression = node.expression;
    let name, rule, repeater, tree, n, sequence;

    function error(message) {
      throw new GrammarError(message, node.location);
    }

    switch (expression.type) {
      case "rule_ref":
        rule = findRule(expression);
        name = expression.name;
        if (!isRepeater(rule)) {
          error("Expecting " + mode + " at " + position(node) + " to update a  repeater expression.");
        }
        break;

      // NOTE: add a case for choice
      // NOTE: add a case for sequence?

      default:
        error("Expecting a rule_ref at " + position(expression));
    }

    if (!__hasOwnProperty.call(repeaters, name)) {
      repeaters[name] = {
        sequences: [],
        createRefrence() {
          return {
            type: "rule_ref",
            name: name,
            location: expression.location
          };
        },
        required: rule.type === "zero_or_more" ? 0 : 1
      };
    }
    repeater = repeaters[name];

    if (node.type === "increment_match") {
      repeater.required += 1;
    } else {
      repeater.required -= 1;
    }

    n = repeater.required;

    if (n < 0) {
      error("The decrement_match at " + position(node) + " has reduced the required amount to -1");
    }
    sequence = repeater.sequences[n];
    if (!sequence) {
      sequence = repeater.sequences[n]
               = (new Array(n)).map(repeater.createRefrence);
    }

    tree = {
      // This is the new rule we are adding
      type: "rule",
      name: name + "$" + mode + "$" + n,
      expression: {

        // A cleaner name for error's
        type: "named",
        name: name + " * " + n,
        expression: {

          // The action that returns an array with the results of `rule * n`
          type: "action",
          code: " return repeated_rule; ",
          expression: {

            // The parameter name for the action
            type: "labeled",
            label: "repeated_rule",
            expression: {

              // Encapsulate the sequence with `( ...rule_ref )`
              type: "group",
              expression: {

                // We are returning a sequence of `rule_ref`
                type: "sequence",
                elements: sequence,
                location: node.location
              }

            },
            location: node.location

          },
          location: node.location

        },
        location: rule.location

      },
      location: node.location
    };

    node.type = "rule_ref";
    node.name = tree.name;
    newRules.push(tree);
  }

  let preprocess = visitor.build({

    sequence(node) {
      node.elements = node.elements.filter(child => {
        let remove = false;
        preprocess(child, () => {
          remove = true;
        });

        return remove === true;
      });
    },

    labeled(node) {
      preprocess(node.expression, ast => {
        node.expression = ast;
      });
    },

    increment_match: evaluate,
    decrement_match: evaluate

  });

  preprocess(ast);

  ast.rules.push(newRules);
}

module.exports = controlRepetition;
