# A real Manim Community script, unchanged. Run it:   pymations run derivative.py
# Share it:   pymations build derivative.py -o derivative.html

from manim import *

# Explainer: the derivative as the limit of secant slopes, for f(x) = x^2 / 2 at x = 1.

CURVE, POINT, SECANT, TANGENT = BLUE, YELLOW, ORANGE, GREEN
X0 = 1.0


def f(x):
    return x * x / 2


def make_axes():
    return Axes(x_range=[0, 4, 1], y_range=[0, 8, 2], x_length=6, y_length=5, tips=False).to_edge(LEFT, buff=0.8).shift(DOWN * 0.4)


def secant(ax, h, color=SECANT):
    m = (f(X0 + h) - f(X0)) / h
    line = Line(ax.c2p(0.2, f(X0) + m * (0.2 - X0)), ax.c2p(3.6, f(X0) + m * (3.6 - X0)), color=color)
    q = Dot(ax.c2p(X0 + h, f(X0 + h)), color=SECANT)
    return VGroup(line, q)


def h_label(h):
    return MathTex("h", "=", f"{h:.2f}").to_corner(UR, buff=0.8)


class Curve(Scene):
    def construct(self):
        title = Text("What is a derivative?", font_size=40).to_edge(UP)
        self.play(Write(title))
        ax = make_axes()
        graph = ax.plot(f, x_range=[0, 3.9], color=CURVE)
        label = MathTex(r"f(x) = \tfrac{1}{2}x^2", color=CURVE).next_to(ax.c2p(3.9, f(3.9)), LEFT)
        self.play(Create(ax), run_time=1.5)
        self.play(Create(graph), Write(label), run_time=2)
        p = Dot(ax.c2p(X0, f(X0)), color=POINT)
        p_label = MathTex("(1, f(1))", font_size=32, color=POINT).next_to(p, RIGHT)
        self.play(GrowFromCenter(p), FadeIn(p_label, shift=RIGHT * 0.3))
        q = Dot(ax.c2p(3, f(3)), color=SECANT)
        line = Line(ax.c2p(X0, f(X0)), ax.c2p(3, f(3)), color=SECANT)
        question = Text("How steep is the curve here?", font_size=30).to_edge(RIGHT, buff=0.6)
        self.play(Write(question))
        self.play(GrowFromCenter(q), Create(line))
        self.wait(1.5)


class Secants(Scene):
    def construct(self):
        ax = make_axes()
        graph = ax.plot(f, x_range=[0, 3.9], color=CURVE)
        p = Dot(ax.c2p(X0, f(X0)), color=POINT)
        self.add(ax, graph, p)

        slope = MathTex("m", "=", r"\frac{f(1+h) - f(1)}{h}").to_edge(RIGHT, buff=0.8).shift(UP * 0.5)
        self.play(Write(slope))

        hs = [2.0, 1.0, 0.5, 0.25, 0.1, 0.02]
        sec = secant(ax, hs[0])
        lab = h_label(hs[0])
        self.play(Create(sec[0]), GrowFromCenter(sec[1]), Write(lab))
        for h in hs[1:]:
            self.play(Transform(sec, secant(ax, h)), Transform(lab, h_label(h)), run_time=1.2)
        self.wait()

        limit = MathTex("f'(1)", "=", r"\lim_{h \to 0}", r"\frac{f(1+h) - f(1)}{h}").to_edge(RIGHT, buff=0.5).shift(UP * 0.5)
        self.play(TransformMatchingTex(slope, limit), run_time=1.5)
        self.wait(1.5)


class Tangent(MovingCameraScene):
    def construct(self):
        ax = make_axes()
        graph = ax.plot(f, x_range=[0, 3.9], color=CURVE)
        p = Dot(ax.c2p(X0, f(X0)), color=POINT)
        sec = secant(ax, 0.02)
        self.add(ax, graph, sec, p)

        tangent = Line(ax.c2p(0.2, f(X0) - 0.8), ax.c2p(3.6, f(X0) + 2.6), color=TANGENT)
        self.play(ReplacementTransform(sec[0], tangent), FadeOut(sec[1]))
        self.play(self.camera.frame.animate.scale(0.45).move_to(p), run_time=2)
        self.wait(0.5)
        self.play(self.camera.frame.animate.scale(1 / 0.45).move_to(ORIGIN), run_time=2)

        steps = MathTex(r"\frac{\tfrac12(1+h)^2 - \tfrac12}{h}", "=", r"1 + \tfrac{h}{2}").to_edge(RIGHT, buff=0.6).shift(UP * 1.5)
        result = MathTex("f'(1)", "=", "1", color=TANGENT, font_size=60).next_to(steps, DOWN, buff=0.8)
        self.play(Write(steps))
        self.play(Write(result))
        self.play(Circumscribe(result, color=TANGENT))
        self.wait(1.5)
