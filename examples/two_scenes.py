# Two scenes in one file. Every Scene class plays, in the order it is written,
# each starting empty; the scrubber has a tick where the second one starts.
# Run it:   pymations run two_scenes.py

from pymations import *


class Shapes(Scene):
    def construct(self):
        shapes = VGroup(Circle(), Square(), Triangle()).arrange(RIGHT, buff=1)
        self.play(LaggedStart(*[Create(s) for s in shapes], lag_ratio=0.3))
        self.play(shapes.animate.set_color(TEAL))
        self.wait()


class Words(Scene):
    def construct(self):
        title = Text("Second scene")
        self.play(Write(title))
        self.play(title.animate.to_edge(UP))
        self.play(FadeIn(Text("It starts empty", font_size=36), shift=UP))
        self.wait()
