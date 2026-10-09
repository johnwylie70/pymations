# A real Manim Community script, unchanged. Run it:   pymations run riemann_sum.py
# Share it:   pymations build riemann_sum.py -o riemann_sum.html

from manim import *

# Updaters: Riemann rectangles refine as dx shrinks, and the running sum closes in on the integral (4/3).

CURVE, RECT_A, RECT_B = YELLOW, BLUE, GREEN


def f(x):
    return x * x / 2


def make_axes():
    return Axes(x_range=[0, 2.2, 0.5], y_range=[0, 2.2, 0.5], x_length=6, y_length=5, tips=False).shift(LEFT * 2.5 + DOWN * 0.3)


def riemann_sum(dx):
    n = round(2 / dx)
    return sum(f(i * dx) * dx for i in range(n))


class Rectangles(Scene):
    def construct(self):
        title = Text("Area under a curve", font_size=40).to_edge(UP)
        self.play(Write(title))
        ax = make_axes()
        graph = ax.plot(f, x_range=[0, 2.1], color=CURVE)
        self.play(Create(ax), Create(graph), run_time=2)

        integral = MathTex(r"\int_0^2 \tfrac{1}{2}x^2\,dx", "=", r"\tfrac{4}{3}").to_edge(RIGHT, buff=0.8).shift(UP * 1.5)
        rects = ax.get_riemann_rectangles(graph, x_range=[0, 2], dx=0.5, color=(RECT_A, RECT_B), fill_opacity=0.7)
        self.play(LaggedStart(*[GrowFromEdge(r, DOWN) for r in rects], lag_ratio=0.15), run_time=2)
        self.play(Write(integral[0]))
        self.wait()


class Refine(Scene):
    def construct(self):
        ax = make_axes()
        graph = ax.plot(f, x_range=[0, 2.1], color=CURVE)
        integral = MathTex(r"\int_0^2 \tfrac{1}{2}x^2\,dx", "=", r"\tfrac{4}{3}").to_edge(RIGHT, buff=0.8).shift(UP * 1.5)
        rects = ax.get_riemann_rectangles(graph, x_range=[0, 2], dx=0.5, color=(RECT_A, RECT_B), fill_opacity=0.7)
        self.add(ax, graph, rects, integral[0])

        dx_label = MathTex(r"\Delta x =", font_size=40).next_to(integral, DOWN, buff=0.9).align_to(integral, LEFT)
        dx_num = DecimalNumber(0.5, num_decimal_places=3, font_size=40).next_to(dx_label, RIGHT)
        sum_label = MathTex(r"\text{sum} =", font_size=40).next_to(dx_label, DOWN, buff=0.4).align_to(dx_label, LEFT)
        sum_num = DecimalNumber(riemann_sum(0.5), num_decimal_places=4, font_size=40).next_to(sum_label, RIGHT)
        self.play(FadeIn(dx_label), FadeIn(dx_num), FadeIn(sum_label), FadeIn(sum_num))

        for dx in (0.25, 0.1, 0.05, 0.02):
            new = ax.get_riemann_rectangles(graph, x_range=[0, 2], dx=dx, color=(RECT_A, RECT_B), fill_opacity=0.7)
            self.play(
                Transform(rects, new),
                ChangeDecimalToValue(dx_num, dx),
                ChangeDecimalToValue(sum_num, riemann_sum(dx)),
                run_time=1.5,
            )
            self.wait(0.3)

        self.play(Write(integral[1:]))
        self.play(Circumscribe(integral, color=CURVE))
        self.wait()
