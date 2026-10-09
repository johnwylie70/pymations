# Hello, the class form: the same scene written the way Manim tutorials write it.
# Run it:   pymations run hello_class.py

from pymations import *


class Hello(Scene):
    def construct(self):
        square = Square(color=YELLOW)
        circle = Circle(color=BLUE, fill_opacity=0.5)

        self.play(Create(square))
        self.play(Transform(square, circle))
        self.play(square.animate.shift(RIGHT * 2).scale(0.5))
        self.wait()
