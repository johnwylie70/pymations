# Hello: a square drawn, turned into a circle, then moved. The bare form: no class.
# Run it:   pymations run hello.py
# Share it: pymations build hello.py -o hello.html

from pymations import *

square = Square(color=YELLOW)
circle = Circle(color=BLUE, fill_opacity=0.5)

play(Create(square))
play(Transform(square, circle))
play(square.animate.shift(RIGHT * 2).scale(0.5))
wait()
