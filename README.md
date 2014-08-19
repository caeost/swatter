swatter
=======

Basically trying to do a few things with "debugging".

Was thinking that debuggers are pretty cool, but often limited. They get used too late, when the bug is found and its critical, because they are not actually very useful for understanding your code.

It feels like the general shape of debugging could also be used to produce a better experience for understanding the code. This is partially motivated by: [http://worrydream.com/#!/LearnableProgramming](http://worrydream.com/#!/LearnableProgramming). And also by less thought out things.

Right now this means a scrubber so you can go back and forth through the values of the code and see how they change. It is quite rudimentary, hence the small version number, but there are a lot of areas to go. In terms of this first functionality graphs for values so you can see how they change overtime (after all we use them for other complex number representations), better highlighting of what changes inside objects, better symbolization of loops, and more robustness are gonna happen.

Later planning on trying to add some other features such as debugging inlining to roll in function calls etc. I also have a list of other things on my other computer but ~effort~.

###to use
Open index.html paste some JS into the textarea, it will be evaluated and hopefully something will work, then use the slider to move through all the variable assignments. You can click on a variable in the assignment window to see its values throughout the program.

###caveats
1. variables are currently tracked by name only, so same named values will be seen as same thing, should change this.
2. it only cares about variable assignment and declarations, so more specialized ways of changing values are currently not captured.
3. It's not a debugger as such, its a variable viewer, so it will skip past lines with no seen assignments.
4. Cause of the way I'm capturing variables (which i swear i have a reason for) the functions seen in the variable screen will have a buncha extra junk in them.
5. probably a buncha other stuff.

###Screencast
The state as of 8/19/2014: http://screencast.com/t/XWpBYbSW
