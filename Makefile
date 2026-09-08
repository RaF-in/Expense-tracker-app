NAMESPACE := expense-tracker
SERVICE_DIRS := core-api:services/core-api receipt-service:services/receipt-service ingestion-service:services/ingestion-service frontend:frontend
VALID_LOGS_SVCS := core-api receipt-service ingestion-service frontend postgres rabbitmq
INGRESS_NGINX_MANIFEST := https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.11.3/deploy/static/provider/cloud/deploy.yaml

.PHONY: build deploy status logs teardown restart ingress-nginx-install ingress-nginx-uninstall

build:
	@for entry in $(SERVICE_DIRS); do \
		svc=$${entry%%:*}; dir=$${entry#*:}; \
		echo "Building expense-tracker/$$svc:local from $$dir ..."; \
		docker build -t expense-tracker/$$svc:local $$dir || \
			{ echo "Build failed for $$svc"; exit 1; }; \
	done

deploy:
	@for entry in $(SERVICE_DIRS); do \
		svc=$${entry%%:*}; \
		docker image inspect expense-tracker/$$svc:local >/dev/null 2>&1 || \
			{ echo "Missing image expense-tracker/$$svc:local — run 'make build' first."; exit 1; }; \
	done
	@[ -f k8s/secrets.yaml ] || \
		{ echo "k8s/secrets.yaml not found — copy k8s/secrets.yaml.template to k8s/secrets.yaml and fill in the values."; exit 1; }
	kubectl apply -f k8s/namespace.yaml -f k8s/secrets.yaml
	kubectl apply -f k8s/

status:
	kubectl get all,pvc -n $(NAMESPACE)

logs:
	@if [ -z "$(svc)" ]; then \
		echo "Usage: make logs svc=<name>"; \
		echo "Valid service names: $(VALID_LOGS_SVCS)"; \
		exit 1; \
	fi; \
	case "$(svc)" in \
		postgres) kind=sts ;; \
		core-api|receipt-service|ingestion-service|frontend|rabbitmq) kind=deployment ;; \
		*) echo "Unknown service '$(svc)'"; echo "Valid service names: $(VALID_LOGS_SVCS)"; exit 1 ;; \
	esac; \
	kubectl logs $$kind/$(svc) -n $(NAMESPACE) --follow

teardown:
	kubectl delete ns $(NAMESPACE) --ignore-not-found

# imagePullPolicy is IfNotPresent, so re-applying the same :local tag after
# `make build` does not recreate pods — force a rollout to pick up the new image.
restart:
	@for entry in $(SERVICE_DIRS); do \
		svc=$${entry%%:*}; \
		kubectl rollout restart deployment/$$svc -n $(NAMESPACE); \
	done
	@for entry in $(SERVICE_DIRS); do \
		svc=$${entry%%:*}; \
		kubectl rollout status deployment/$$svc -n $(NAMESPACE); \
	done

# --- ingress-nginx (cluster-wide add-on, not part of k8s/) ---

ingress-nginx-install:
	kubectl apply -f $(INGRESS_NGINX_MANIFEST)
	kubectl wait --namespace ingress-nginx \
		--for=condition=ready pod \
		--selector=app.kubernetes.io/component=controller \
		--timeout=120s

ingress-nginx-uninstall:
	kubectl delete -f $(INGRESS_NGINX_MANIFEST) --ignore-not-found
