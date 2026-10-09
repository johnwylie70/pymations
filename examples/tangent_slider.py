# A real Manim Community script, unchanged. Run it:   pymations run tangent_slider.py
# Share it:   pymations build tangent_slider.py -o tangent_slider.html

from manim import *

# Updaters: a tangent line slides along a cubic, driven by a ValueTracker, with a live slope readout.

CURVE, TANGENT, POINT = BLUE, YELLOW, ORANGE


def f(x):
    return 0.2 * x ** 3 - 1.2 * x


def df(x):
    return 0.6 * x ** 2 - 1.2


def half_step(x):
    # Half the tangent's x-extent, so the drawn segment has the same length (1.5 data units) at every slope.
    return 1.5 / (1 + df(x) ** 2) ** 0.5


def make_axes():
    return Axes(x_range=[-3, 3, 1], y_range=[-3, 3, 1], x_length=7, y_length=5.5, tips=False).shift(LEFT * 2.2 + DOWN * 0.3)


class Intro(Scene):
    def construct(self):
        title = Text("Sliding a tangent line", font_size=40).to_edge(UP)
        self.play(Write(title))
        ax = make_axes()
        graph = ax.plot(f, x_range=[-2.9, 2.9], color=CURVE)
        label = MathTex(r"f(x) = 0.2x^3 - 1.2x", color=CURVE, font_size=36).to_edge(RIGHT, buff=0.6).shift(UP * 1.5)
        self.play(Create(ax), run_time=1.5)
        self.play(Create(graph), Write(label), run_time=2)
        self.wait()


class Slide(Scene):
    def construct(self):
        ax = make_axes()
        graph = ax.plot(f, x_range=[-2.9, 2.9], color=CURVE)
        label = MathTex(r"f(x) = 0.2x^3 - 1.2x", color=CURVE, font_size=36).to_edge(RIGHT, buff=0.6).shift(UP * 1.5)
        self.add(ax, graph, label)

        x = ValueTracker(-2.5)
        dot = always_redraw(lambda: Dot(ax.c2p(x.get_value(), f(x.get_value())), color=POINT))
        tangent = always_redraw(
            lambda: Line(
                ax.c2p(x.get_value() - half_step(x.get_value()),
                       f(x.get_value()) - df(x.get_value()) * half_step(x.get_value())),
                ax.c2p(x.get_value() + half_step(x.get_value()),
                       f(x.get_value()) + df(x.get_value()) * half_step(x.get_value())),
                color=TANGENT,
            )
        )
        slope_label = MathTex("f'(x) =", font_size=40).next_to(label, DOWN, buff=0.8).align_to(label, LEFT)
        slope = DecimalNumber(df(-2.5), num_decimal_places=2, include_sign=True, font_size=40)
        slope.add_updater(lambda m: m.set_value(df(x.get_value())).next_to(slope_label, RIGHT))
        x_label = MathTex("x =", font_size=40).next_to(slope_label, DOWN, buff=0.4).align_to(slope_label, LEFT)
        x_num = DecimalNumber(-2.5, num_decimal_places=2, font_size=40)
        x_num.add_updater(lambda m: m.set_value(x.get_value()).next_to(x_label, RIGHT))

        self.play(GrowFromCenter(dot), Create(tangent), Write(slope_label), Write(x_label), FadeIn(slope), FadeIn(x_num))
        self.play(x.animate.set_value(2.5), run_time=6)
        self.wait(0.5)
        self.play(x.animate.set_value(1.4142), run_time=2)
        flat = Text("slope 0: a turning point", font_size=28, color=TANGENT).next_to(x_label, DOWN, buff=0.6).align_to(x_label, LEFT)
        self.play(Write(flat))
        self.play(x.animate.set_value(-1.4142), run_time=3)
        self.wait()
