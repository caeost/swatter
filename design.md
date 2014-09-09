## show read values
* pretty key

## rebuild details view
* show number value changes over time as graphs with highlighting of where the change happened
* diff strings and promininently show changed parts of large strings
* allow digging into objects keys and mapping diffing those as desired
* allow moving and placing of these views and live updating them

## then highlighting variables the same color
* whether its in value or name mode
* need to chose colors somewhat carefully (first version can be lazy) to keep them all seperate.

## inlining function calls on click or whatever and seeing what happened in them
* go down as far as you want
* might require some restyling

## if else branch highlighting to gray out ones not chosen
* obviously case and all that too

## finally live editing
* use some editor like ACE or that one thats on microjs
* allow people to directly edit number and string literals, typing inline or dragging numbers
  * show live changes in rest of code as edits happen (might be performance questions here)
  * maybe even allow live editing of values, like if: var x = 1; var y = x; changing y could make var y = x + {change}
  * reflect changes back to original code
* allow selecting a chunk of code and editing of it within the editor, but inline into the viewing mode, live changes too
* performance concerns could also show up
* such as showing long scope lookups or whatever.

# save initializer variables and make them serializable for sending to people with url
* could be useful to reproduce bugs
* could be even more useful if could automatically save them based off of all the changes

# auto inject a series of values for variables and test them
* low priority

# at some point make it literate
